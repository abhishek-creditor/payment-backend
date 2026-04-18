const prisma = require("../config/prismaClient");
const productUserDAO = require("../dao/productUser.dao");
const orderDAO = require("../dao/order.dao");
const paymentDAO = require("../dao/payment.dao");
const refundDAO = require("../dao/refund.dao");
const TilledService = require("./tilled.service");
const { buildTilledMetadata } = require("./tilledMetadata.service");
const { resolveCurrency } = require("../config/countryCurrency");
const productPlanPriceDAO = require("../dao/productPlanPrice.dao");

// Assume Tilled SDK instance

/**
 * CREATE PAYMENT
 *
 * State Machine:
 * 1️⃣ DB Transaction → Create Order + Payment(INITIATED)
 * 2️⃣ Commit
 * 3️⃣ Call Tilled with idempotencyKey
 * 4️⃣ Update Payment + Order based on status
 */
exports.createPayment = async (productId, data, options = {}) => {
  const { idempotencyKey } = options;

  const {
    externalUserId,
    productUserId,
    email,
    user_email,
    referenceId,
    productPlanId,
    paymentMethod = "CARD",
    tilledAccountId,
    account_id,
    items: rawItems,
    extraData = {},
    country,
  } = data;

  const resolvedExternalUserId = externalUserId || productUserId;
  const resolvedEmail = email || user_email;
  const resolvedAccountId = tilledAccountId || account_id;
  const items = Array.isArray(rawItems)
    ? rawItems
    : Array.isArray(extraData?.items)
      ? extraData.items
      : [];

  const plan = await prisma.productPlan.findFirst({
    where: {
      id: productPlanId,
      productId,
      isActive: true,
    },
    include: {
      product: true,
    },
  });
  if (!plan) {
    console.log("Invalid ProductId or productPlanId", productPlanId);
    throw new Error("Invalid ProductId or productPlanId");
  }
  // --- Country → Currency → Price resolution ---
  let amount, currency;

  if (country) {
    // Product backend sent the user's country — resolve to local currency
    currency = resolveCurrency(country);
    const planPrice = await productPlanPriceDAO.findPrice(null, plan.id, currency);
    if (!planPrice) {
      const error = new Error(
        `Plan "${plan.name}" is not available in ${currency} (country: ${country})`
      );
      error.statusCode = 400;
      throw error;
    }
    amount = planPrice.amount;
    // planPrice.gateway can be used by the gateway factory for per-currency routing
    console.log(`[Currency] country=${country} → currency=${currency}, amount=${amount}`);
  } else {
    // Legacy fallback — no country sent, use plan's default price/currency
    if (!plan.price || !plan.currency) {
      throw new Error("Invalid plan configuration — provide country or ensure plan has default price");
    }
    amount = plan.price;
    currency = plan.currency;
    console.log(`[Currency] No country provided, using plan default: ${currency}, amount=${amount}`);
  }

  // ---------------------------
  // STEP 1: DB TRANSACTION
  // ---------------------------
  const result = await prisma.$transaction(async (tx) => {
    const productUser = await productUserDAO.upsertProductUser(
      tx,
      productId,
      resolvedExternalUserId,
      resolvedEmail,
    );

    const existingOrder = await orderDAO.getOrderByReferenceId(
      tx,
      productId,
      referenceId,
    );

    // ==========================================
    // CASE: ORDER EXISTS
    // ==========================================

    if (existingOrder) {
      const latestPayment = existingOrder.payments?.sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
      )[0];

      if (!latestPayment) {
        const newPayment = await paymentDAO.createPayment(tx, {
          orderId: existingOrder.id,
          method: paymentMethod,
          status: "INITIATED",
          amount,
        });
        return {
          order: existingOrder,
          payment: newPayment,
          duplicate: false,
          productUser,
        };
      }

      if (latestPayment.status === "SUCCEEDED") {
        return {
          order: existingOrder,
          duplicate: true,
          payment: latestPayment,
          productUser,
        };
      }

      // Still processing (only PROCESSING means Tilled checkout was created)
      if (latestPayment.status === "PROCESSING") {
        return {
          order: existingOrder,
          payment: latestPayment,
          duplicate: true,
          productUser,
        };
      }

      // Retry allowed (INITIATED means Tilled was never called or failed mid-flow)
      if (
        latestPayment.status === "FAILED" ||
        latestPayment.status === "CANCELLED" ||
        latestPayment.status === "INITIATED"
      ) {
        const newPayment = await paymentDAO.createPayment(tx, {
          orderId: existingOrder.id,
          method: paymentMethod,
          status: "INITIATED",
          amount,
        });
        console.log(
          `Retrying payment for existing order ${existingOrder.id} with new payment ${newPayment.id}`,
        );
        return {
          order: existingOrder,
          payment: newPayment,
          duplicate: false,
          productUser,
        };
      }

      return {
        order: existingOrder,
        payment: latestPayment,
        duplicate: true,
        productUser,
      };
    }

    // ==========================================
    // CASE: ORDER DOES NOT EXIST
    // ==========================================

    const order = await orderDAO.createOrder(tx, {
      productId,
      productUserId: productUser.id,
      planId: plan.id,
      referenceId,
      amount,
      currency,
      status: "CREATED",
      orderType: plan.billingType === "RECURRING" ? "SUBSCRIPTION" : "ONE_TIME",
      items,
      metadata: Object.keys(extraData).length > 0 ? extraData : null,
    });

    // Race condition guard: if two concurrent requests both passed the
    // getOrderByReferenceId check above, one will hit a P2002 unique
    // constraint error in the DAO. The DAO handles this by returning
    // the existing order with __duplicate = true. We must check for it.
    if (order.__duplicate) {
      const latestPayment = order.payments?.sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
      )[0];

      // Already paid or still processing → treat as duplicate
      if (latestPayment?.status === "SUCCEEDED" || latestPayment?.status === "PROCESSING") {
        return {
          order,
          payment: latestPayment,
          duplicate: true,
          productUser,
        };
      }

      // FAILED/CANCELLED/INITIATED/no payment → allow retry with new payment
      const retryPayment = await paymentDAO.createPayment(tx, {
        orderId: order.id,
        amount,
        method: paymentMethod,
        status: "INITIATED",
      });
      console.log(`Race condition detected: reusing order ${order.id}, created retry payment ${retryPayment.id}`);
      return {
        order,
        payment: retryPayment,
        duplicate: false,
        productUser,
      };
    }

    const payment = await paymentDAO.createPayment(tx, {
      orderId: order.id,
      amount,
      method: paymentMethod,
      status: "INITIATED",
    });

    console.log(`Created new order ${order.id} with payment ${payment.id}`);

    // ------------------------------------------
    // LINK IDEMPOTENCY RECORD WITH ORDER/PAYMENT
    // ------------------------------------------
    // Inside the transaction so the link is atomic with order/payment creation.
    // This is critical because the webhook uses orderId/paymentId to update idempotency status.
    if (idempotencyKey) {
      try {
        const linkResult = await tx.idempotencyKey.updateMany({
          where: { productId, key: idempotencyKey },
          data: { orderId: order.id, paymentId: payment.id },
        });

        console.log("[Idempotency Link]", {
          idempotencyKey,
          orderId: order.id,
          paymentId: payment.id,
          rowsUpdated: linkResult.count,
        });

        if (linkResult.count === 0) {
          console.warn(
            "WARNING: No idempotency record linked. Check middleware or key mismatch.",
          );
        }
      } catch (err) {
        console.error("Failed to link idempotency record:", err);
      }
    }

    return {
      order,
      payment,
      duplicate: false,
      productUser,
    };
  });

  if (result.duplicate) {
    const latestPayment = result.order.payments?.sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
    )[0];

    return {
      ...result.order,
      payments: latestPayment ? [latestPayment] : [],
      duplicate: true,
    };
  }

  const { order, payment, productUser } = result;

  // ==========================================
  // STEP 2: CALL TILLED
  // ==========================================

  // NOTE: Payment stays INITIATED until the Tilled checkout session is
  // successfully created. Only then do we update to PROCESSING (line below).
  // State flow: INITIATED → PROCESSING → (SUCCEEDED / FAILED / CANCELLED)
  // This way, if the Tilled call fails, the payment stays INITIATED and
  // can be retried safely.
  // 3. Create or get Tilled Customer
  let tilledCustomer = null;
  const targetAccountId = resolvedAccountId;
  const resolvedFirstName = data.firstname || data.name || data.user_name || resolvedExternalUserId;
  const resolvedLastName = data.lastname || '';

  const existingCustomerId =
    productUser.tilledCustomerId || extraData?.userTilledId;

  if (existingCustomerId) {
    try {
      const getCustomerResponse = await TilledService.getCustomer(
        existingCustomerId,
        targetAccountId,
      );
      if (
        getCustomerResponse.statusCode >= 200 &&
        getCustomerResponse.statusCode < 300
      ) {
        tilledCustomer = getCustomerResponse.data;
      }
    } catch (error) {
      console.error(
        `Could not fetch existing Tilled customer ${existingCustomerId}, will create a new one.`,
      );
    }
  }

  if (!tilledCustomer) {
    const tilledCustomerResponse = await TilledService.createCustomer({
      email: resolvedEmail,
      first_name: resolvedFirstName,
      last_name: resolvedLastName,
      metadata: {
        externalUserId: resolvedExternalUserId,
        productId: productId
      }
    }, targetAccountId);
    tilledCustomer = tilledCustomerResponse.data;

    await productUserDAO.updateTilledCustomerId(
      null,
      productUser.id,
      tilledCustomer.id,
    );
  }

  // ==========================================
  // CASE 1: RECURRING SUBSCRIPTION (Custom Tilled.js Page)
  // ==========================================
  if (plan.billingType === "RECURRING") {
    const baseUrl = process.env.FRONTEND_PAYMENT_PAGE_URL || "https://payment-checkoutt.netlify.app";
    const publishableKey = process.env.TILLED_SANDBOX_PUBLISHABLE_KEY || process.env.TILLED_PUBLISHABLE_KEY;

    // Construct query params so the central page knows what to do
    const queryParams = new URLSearchParams({
      orderId: order.id,
      tilledAccountId: tilledCustomer.account_id || targetAccountId,
      publishableKey: publishableKey,
      amount: amount,
      currency: currency,
      email: resolvedEmail,
      customer_name: `${resolvedFirstName} ${resolvedLastName}`.trim()
      // Success and cancel redirections are handled natively by the frontend checkout page
    });

    const customCheckoutUrl = `${baseUrl}?${queryParams.toString()}`;

    // Status remains INITIATED until they complete payment on the custom page
    return {
      ...order,
      payments: [
        {
          ...payment,
          status: "INITIATED",
        },
      ],
      duplicate: false,
      checkoutUrl: customCheckoutUrl,
    };
  }

  // ==========================================
  // CASE 2: ONE-TIME PAYMENT (Tilled Checkout Session)
  // ==========================================
  const lineItems = [{
    price_data: {
      currency: currency,
      product_data: {
        name: plan.name || `Plan ${plan.code}` || "Order Payment"
      },
      unit_amount: amount
    },
    quantity: 1
  }];

  // Calculate platform fee: 20% for Ebook products
  const isEbook = plan.product.name?.toLowerCase() === "ebook";
  const platformFee = isEbook ? Math.round(amount * 0.20) : null;

  const tilledMetadata = buildTilledMetadata(order, plan.product, {
    ...extraData,
    externalUserId: resolvedExternalUserId,
    planName: plan.name,
    planId: plan.id,
    billingType: plan.billingType,
  });

  const checkoutSessionResponse = await TilledService.createCheckoutSession({
    customer_id: tilledCustomer.id,
    line_items: lineItems,
    mode: 'payment',
    success_url: extraData?.success_url || 'https://payment-pagess.netlify.app/success',
    cancel_url: extraData?.cancel_url || 'https://payment-pagess.netlify.app/cancelled',
    payment_intent_data: {
      description: `Order ${order.id}`,
      // we can remove setup_future_usage here since it's for one-off payments
      // but keeping it doesn't hurt if we want to save the card anyway
      setup_future_usage: "off_session",
      payment_method_types: ["card"],
      metadata: tilledMetadata,
      ...(platformFee && { platform_fee_amount: platformFee })
    }
  }, targetAccountId);

  console.log("Checkout Session Response:", checkoutSessionResponse);

  const checkoutSession = checkoutSessionResponse.data;

  if (checkoutSessionResponse.statusCode >= 400) {
    throw new Error(
      `Tilled Error: ${checkoutSession.message || checkoutSession.error || "Failed to create checkout session"}`,
    );
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: "PROCESSING",
      tilledPaymentId: checkoutSession.payment_intent_id,
    },
  });

  return {
    ...order,
    payments: [
      {
        ...payment,
        status: "PROCESSING",
        tilledPaymentId: checkoutSession.payment_intent_id,
      },
    ],
    duplicate: false,
    checkoutUrl: checkoutSession?.url,
  };
};

/**
 * CONFIRM SUBSCRIPTION PAYMENT (Tilled.js Flow)
 * 1. Find Order & ProductUser
 * 2. Attach payment_method_id to Tilled Customer
 * 3. Create Subscription in Tilled
 * 4. Update DB (Order -> COMPLETED, Payment -> SUCCEEDED, Subscription -> ACTIVE)
 * 5. Dispatch success webhook
 */
exports.confirmSubscriptionPayment = async (productId, orderId, paymentMethodId, tilledAccountId, options = {}) => {
  const { idempotencyKey } = options;

  console.log(`\n========== CONFIRM SUBSCRIPTION PAYMENT ==========`);
  console.log(`[Confirm] OrderId: ${orderId}`);
  console.log(`[Confirm] ProductId: ${productId}`);
  console.log(`[Confirm] PaymentMethodId: ${paymentMethodId}`);
  console.log(`[Confirm] TilledAccountId: ${tilledAccountId || 'not provided (using platform)'}`);

  // 1. Fetch Order and Verify it's ready for confirmation
  console.log(`[Step 1] Fetching order...`);
  const order = await orderDAO.getOrderById(null, orderId, {
    productUser: true,
    payments: true,
    plan: true,
  });

  if (!order || order.productId !== productId) {
    console.error(`[Step 1] ❌ Order not found or productId mismatch. Order exists: ${!!order}`);
    const error = new Error("Order not found or invalid");
    error.statusCode = 404;
    throw error;
  }

  console.log(`[Step 1] ✅ Order found | Status: ${order.status} | Type: ${order.orderType} | Plan: ${order.plan?.name}`);

  if (order.status === "PAID") {
    console.log(`[Step 1] ⚠️ Order already PAID — returning early`);
    return { status: "already_completed", success: true, orderId };
  }

  if (order.orderType !== "SUBSCRIPTION" || order.plan?.billingType !== "RECURRING") {
    console.error(`[Step 1] ❌ Not a subscription order. Type: ${order.orderType}, BillingType: ${order.plan?.billingType}`);
    const error = new Error("This order is not a subscription");
    error.statusCode = 400;
    throw error;
  }

  const payment = order.payments?.find(p => p.status === "INITIATED" || p.status === "PENDING");
  if (!payment) {
    console.error(`[Step 1] ❌ No INITIATED/PENDING payment found. Payments:`, order.payments?.map(p => ({ id: p.id, status: p.status })));
    const error = new Error("No valid payment found to confirm");
    error.statusCode = 400;
    throw error;
  }

  console.log(`[Step 1] ✅ Payment found | PaymentId: ${payment.id} | Status: ${payment.status}`);

  const { productUser, plan } = order;
  if (!productUser.tilledCustomerId) {
    console.error(`[Step 1] ❌ Tilled Customer ID missing for ProductUser: ${productUser.id}`);
    const error = new Error("Tilled Customer ID missing for user. The checkout initiation failed.");
    error.statusCode = 400;
    throw error;
  }

  console.log(`[Step 1] ✅ Customer: ${productUser.tilledCustomerId} | Plan: ${plan.name} ($${plan.price / 100} ${plan.currency} / ${plan.intervalCount} ${plan.interval})`);

  // Determine Tilled Account ID (passed from frontend/created during session)
  const targetAccountId = tilledAccountId || null;

  try {
    // 2. Attach Payment Method to Customer
    console.log(`[Step 2] Attaching payment method ${paymentMethodId} to customer ${productUser.tilledCustomerId}...`);
    const attachResponse = await TilledService.attachPaymentMethodToCustomer(
      paymentMethodId,
      productUser.tilledCustomerId,
      tilledAccountId
    );

    if (attachResponse.statusCode >= 400) {
      const isDuplicateCard = attachResponse.data?.message?.includes('already associated with this customer on another PaymentMethod');

      if (isDuplicateCard) {
        console.warn(`[Step 2] ⚠️ Card already attached under a different ID. Attempting to find existing PaymentMethod...`);

        // Fetch the new payment method details to get card info
        let newCardInfo = null;
        try {
          const newPmDetails = await TilledService.getPaymentMethod(paymentMethodId, tilledAccountId);
          if (newPmDetails.statusCode === 200 && newPmDetails.data?.card) {
            newCardInfo = newPmDetails.data.card;
            console.log(`[Step 2 Debug] New PM Card Details: last4=${newCardInfo.last4}, exp_month=${newCardInfo.exp_month}, exp_year=${newCardInfo.exp_year}`);
          } else {
            console.warn(`[Step 2] ⚠️ Could not fetch new PM details (status: ${newPmDetails.statusCode}). Will try matching by listing all PMs.`);
          }
        } catch (fetchErr) {
          console.warn(`[Step 2] ⚠️ Error fetching new PM details: ${fetchErr.message}. Will try listing all PMs.`);
        }

        // List customer's saved payment methods (with pagination support)
        const customerPms = await TilledService.listCustomerPaymentMethods(productUser.tilledCustomerId, tilledAccountId);
        console.log(`[Step 2 Debug] Customer PMs response: status=${customerPms.statusCode}, count=${customerPms.data?.items?.length ?? 0}`);

        if (customerPms.statusCode === 200 && customerPms.data?.items?.length > 0) {
          const allPms = customerPms.data.items;

          // Log all PMs for debugging
          allPms.forEach(pm => {
            console.log(`[Step 2 Debug] Existing PM: id=${pm.id}, last4=${pm.card?.last4}, exp=${pm.card?.exp_month}/${pm.card?.exp_year}, status=${pm.status}`);
          });

          let existingPm = null;

          if (newCardInfo) {
            const { last4, exp_month, exp_year } = newCardInfo;

            // Try exact match first (last4 + exp_month + exp_year)
            existingPm = allPms.find(pm =>
              pm.card && String(pm.card.last4) === String(last4) &&
              Number(pm.card.exp_month) === Number(exp_month) &&
              Number(pm.card.exp_year) === Number(exp_year) &&
              pm.id !== paymentMethodId
            );

            // Fallback: match by last4 only (in case exp dates differ in format)
            if (!existingPm) {
              console.warn(`[Step 2] ⚠️ Exact match failed. Trying last4-only match...`);
              existingPm = allPms.find(pm =>
                pm.card && String(pm.card.last4) === String(last4) &&
                pm.id !== paymentMethodId
              );
            }
          }

          // Final fallback: use the most recently created card PM that isn't the one we just tried
          if (!existingPm) {
            console.warn(`[Step 2] ⚠️ Card detail match failed. Using most recent existing card PM as fallback.`);
            existingPm = allPms.find(pm => pm.card && pm.id !== paymentMethodId);
          }

          if (existingPm) {
            console.log(`[Step 2] ✅ Found existing PaymentMethod: ${existingPm.id} (last4: ${existingPm.card?.last4}). Using this for subscription.`);
            paymentMethodId = existingPm.id;
          } else {
            console.error(`[Step 2] ❌ No usable existing payment method found for customer ${productUser.tilledCustomerId}`);
            throw new Error(`Failed to find the existing payment method despite duplicate card error.`);
          }
        } else {
          console.error(`[Step 2] ❌ Could not list customer payment methods (status: ${customerPms.statusCode})`);
          throw new Error(`Failed to fetch customer payment methods to resolve duplicate card error.`);
        }
      } else {
        // Tilled API sometimes returns a 400 if it's already attached to *another* customer, or fails for other reasons.
        console.error(`[Step 2] ❌ Attach failed (${attachResponse.statusCode}):`, attachResponse.data);
        const error = new Error(`Failed to attach payment method: ${JSON.stringify(attachResponse.data)}`);
        error.statusCode = 400;
        throw error;
      }
    } else {
      console.log(`[Step 2] ✅ Payment method attached successfully`);
    }

    // 3. Create Subscription in Tilled
    const intervalUnitMap = { MONTH: "month", YEAR: "year" };
    const intervalUnit = intervalUnitMap[plan.interval];

    if (!intervalUnit) {
      console.error(`[Step 3] ❌ Unsupported billing interval: ${plan.interval}`);
      throw new Error(`Unsupported billing interval: ${plan.interval}`);
    }

    const subscriptionData = {
      billing_cycle_anchor: new Date().toISOString().split('T')[0],
      currency: plan.currency.toLowerCase(),
      customer_id: productUser.tilledCustomerId,
      interval_count: plan.intervalCount,
      interval_unit: intervalUnit,
      payment_method_id: paymentMethodId,
      price: plan.price,
      metadata: {
        productId,
        productUserId: productUser.id,
        planId: plan.id,
        orderId: order.id
      },
    };

    console.log(`[Step 3] Creating Tilled subscription...`, {
      customer_id: subscriptionData.customer_id,
      price: subscriptionData.price,
      currency: subscriptionData.currency,
      interval: `${subscriptionData.interval_count} ${subscriptionData.interval_unit}(s)`,
    });

    const tilledResponse = await TilledService.createSubscription(subscriptionData, tilledAccountId);

    if (tilledResponse.statusCode >= 400) {
      console.error(`[Step 3] ❌ Tilled subscription creation failed (${tilledResponse.statusCode}):`, tilledResponse.data);
      const error = new Error(`Tilled Subscription Error: ${JSON.stringify(tilledResponse.data)}`);
      error.statusCode = tilledResponse.statusCode;
      throw error;
    }

    const tilledSubscription = tilledResponse.data;
    console.log(`[Step 3] ✅ Tilled subscription created | ID: ${tilledSubscription.id} | Status: ${tilledSubscription.status}`);
    console.log(`[Step 3] 📅 Tilled dates: current_period_start=${tilledSubscription.current_period_start} (${typeof tilledSubscription.current_period_start}), current_period_end=${tilledSubscription.current_period_end} (${typeof tilledSubscription.current_period_end}), next_payment_at=${tilledSubscription.next_payment_at}, billing_cycle_anchor=${tilledSubscription.billing_cycle_anchor}`);

    // 4. Update Database
    console.log(`[Step 4] Updating database records in transaction...`);
    const subscriptionDAO = require("../dao/subscription.dao");

    await prisma.$transaction(async (tx) => {
      // Update Payment
      await paymentDAO.updatePayment(tx, payment.id, {
        status: "SUCCEEDED",
        tilledPaymentMethodId: paymentMethodId,
        rawResponse: tilledSubscription,
      });
      console.log(`[Step 4]   ✅ Payment ${payment.id} → SUCCEEDED`);

      // Update Order
      await orderDAO.updateOrder(tx, order.id, {
        status: "PAID",
      });
      console.log(`[Step 4]   ✅ Order ${order.id} → PAID`);

      // Upsert Subscription
      // Map Tilled status to valid Prisma SubscriptionStatus enum
      // Valid Prisma values: ACTIVE, INACTIVE, CANCELLED, PAST_DUE, TRIAL
      const tilledStatusMap = {
        active: "ACTIVE",
        pending: "ACTIVE",     // Map Tilled "pending" to ACTIVE
        paused: "INACTIVE",
        canceled: "CANCELLED",
        past_due: "PAST_DUE",
        trialing: "TRIAL",
      };
      const mappedStatus = tilledStatusMap[tilledSubscription.status] || "ACTIVE";

      // Map Tilled response dates — Tilled may return Unix timestamps (numbers)
      // or ISO date strings. Handle both formats safely.
      function safeTilledDate(value, fallback) {
        if (!value && value !== 0) return fallback || new Date();
        if (typeof value === "number" && value < 1e12) return new Date(value * 1000);
        const d = new Date(value);
        return isNaN(d.getTime()) ? (fallback || new Date()) : d;
      }

      const periodStart = safeTilledDate(
        tilledSubscription.current_period_start,
        safeTilledDate(tilledSubscription.billing_cycle_anchor, new Date())
      );

      let periodEnd = safeTilledDate(
        tilledSubscription.current_period_end,
        safeTilledDate(tilledSubscription.next_payment_at, null)
      );

      // If periodEnd is missing or invalid, calculate it based on plan interval
      if (!periodEnd || periodEnd.getTime() <= periodStart.getTime()) {
        periodEnd = new Date(periodStart);
        if (plan.interval === "MONTH") {
          periodEnd.setMonth(periodEnd.getMonth() + (plan.intervalCount || 1));
        } else if (plan.interval === "YEAR") {
          periodEnd.setFullYear(periodEnd.getFullYear() + (plan.intervalCount || 1));
        }
      }

      const subscription = await subscriptionDAO.upsertSubscription(tx, {
        productId,
        productUserId: productUser.id,
        planId: plan.id,
        tilledSubscriptionId: tilledSubscription.id,
        status: mappedStatus,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        metadata: tilledSubscription,
      });
      console.log(`[Step 4]   ✅ Subscription upserted | ID: ${subscription.id} | TilledSubId: ${tilledSubscription.id}`);

      // Link subscription to order
      await orderDAO.updateOrder(tx, order.id, { subscriptionId: subscription.id });
      console.log(`[Step 4]   ✅ Subscription linked to order`);

      // Update Idempotency Key Status if provided
      if (idempotencyKey) {
        await tx.$executeRaw`
          UPDATE "IdempotencyKey"
          SET "status" = CAST('COMPLETED' AS "IdempotencyStatus"), "updatedAt" = NOW(), "responseStatusCode" = 200
          WHERE "key" = ${idempotencyKey}
        `;
        console.log(`[Step 4]   ✅ Idempotency key updated`);
      }
    });

    console.log(`[Step 4] ✅ Database transaction committed successfully`);

    // 5. Webhook will be dispatched asynchronously by Tilled webhooks
    // (see src/services/webhookHandlers/subscription.handler.js)
    console.log(`[Step 5] Awaiting Tilled webhook for subscription.created dispatch...`);

    console.log(`========== ✅ SUBSCRIPTION CONFIRMED SUCCESSFULLY ==========\n`);

    return {
      status: "success",
      subscription_status: tilledSubscription.status || "active",
      tilledSubscriptionId: tilledSubscription.id
    };

  } catch (err) {
    console.error(`========== ❌ SUBSCRIPTION CONFIRMATION FAILED ==========`);
    console.error(`[Error] ${err.message}`);

    // If we successfully attached the payment method but subscription creation failed,
    // detach the payment method to avoid orphaned attachments
    if (err.message?.includes('Tilled Subscription Error') || err.message?.includes('Invalid value')) {
      try {
        console.log(`[Cleanup] Attempting to detach payment method ${paymentMethodId} after failure...`);
        await TilledService.detachPaymentMethod(paymentMethodId, tilledAccountId);
        console.log(`[Cleanup] ✅ Payment method detached successfully`);
      } catch (detachErr) {
        console.warn(`[Cleanup] ⚠️ Could not detach payment method: ${detachErr.message}`);
      }
    }

    throw err;
  }
};

/**
 * GET ORDER STATUS
 * Fetches order and its latest payment status by orderId
 */
exports.getOrderStatus = async (productId, orderId) => {
  console.log(`\n========== FETCH ORDER STATUS ==========`);
  console.log(`[Status] ProductId: ${productId}`);
  console.log(`[Status] OrderId: ${orderId || 'N/A'}`);

  if (!orderId) {
    console.error(`[Status] Missing orderId`);
    const error = new Error("orderId is required");
    error.statusCode = 400;
    throw error;
  }

  console.log(`[Step 1] Fetching order from database...`);
  const order = await orderDAO.getOrderWithLatestPayment(null, productId, orderId);

  if (!order) {
    console.error(`[Step 1] Order not found for orderId: ${orderId}`);
    const error = new Error("Order not found");
    error.statusCode = 404;
    throw error;
  }

  console.log(`[Step 1] Order found | ID: ${order.id} | Status: ${order.status}`);

  // Also getting the latest payment status if relevant
  const latestPayment = order.payments && order.payments.length > 0 ? order.payments[0] : null;
  const paymentStatus = latestPayment ? latestPayment.status : null;

  if (latestPayment) {
    console.log(`[Step 2] Latest Payment found | ID: ${latestPayment.id} | Status: ${paymentStatus}`);
  } else {
    console.log(`[Step 2] No payments associated with this order yet.`);
  }

  console.log(`========== ORDER STATUS FETCHED SUCCESSFULLY ==========\n`);

  return {
    orderId: order.id,
    referenceId: order.referenceId,
    orderStatus: order.status,
    paymentStatus: paymentStatus,
    amount: order.amount,
    currency: order.currency
  };
};
