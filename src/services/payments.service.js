const prisma = require("../config/prismaClient");
const productUserDAO = require("../dao/productUser.dao");
const orderDAO = require("../dao/order.dao");
const paymentDAO = require("../dao/payment.dao");
const refundDAO = require("../dao/refund.dao");
const TilledService = require("./tilled.service");
const { buildTilledMetadata } = require("./tilledMetadata.service");

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
  if (!plan.price || !plan.currency) {
    throw new Error("Invalid plan configuration");
  }
  const amount = plan.price;
  const currency = plan.currency;

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
      currency: currency
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
exports.confirmSubscriptionPayment = async (productId, orderId, paymentMethodId, options = {}) => {
  const { idempotencyKey } = options;

  // 1. Fetch Order and Verify it's ready for confirmation
  const order = await orderDAO.getOrderById(null, orderId, {
    productUser: true,
    payments: true,
    plan: true,
  });

  if (!order || order.productId !== productId) {
    const error = new Error("Order not found or invalid");
    error.statusCode = 404;
    throw error;
  }

  if (order.status === "COMPLETED" || order.status === "PAID") {
    return { status: "already_completed", orderId };
  }

  if (order.orderType !== "SUBSCRIPTION" || order.plan?.billingType !== "RECURRING") {
    const error = new Error("This order is not a subscription");
    error.statusCode = 400;
    throw error;
  }

  const payment = order.payments?.find(p => p.status === "INITIATED" || p.status === "PENDING");
  if (!payment) {
    const error = new Error("No valid payment found to confirm");
    error.statusCode = 400;
    throw error;
  }

  const { productUser, plan } = order;
  if (!productUser.tilledCustomerId) {
    const error = new Error("Tilled Customer ID missing for user. The checkout initiation failed.");
    error.statusCode = 400;
    throw error;
  }

  // Determine Tilled Account ID (ideally saved in payment intent metadata, but fallback to plan.product if possible, or omit if using primary)
  // For safety, we will just use the targetAccountId logic (fallback to null implies platform account, but we'll try to find it)
  // If the product requires connected accounts, it's best to fetch from product environment.
  // For sandbox, we can pass null to use platform account unless specific account is needed.
  // The first step already did: targetAccountId = resolvedAccountId. 
  const tilledAccountId = null; // Update with actual account logic if required

  try {
    // 2. Attach Payment Method to Customer
    const attachResponse = await TilledService.attachPaymentMethodToCustomer(
      paymentMethodId,
      productUser.tilledCustomerId,
      tilledAccountId
    );

    if (attachResponse.statusCode >= 400) {
      const error = new Error(`Failed to attach payment method: ${JSON.stringify(attachResponse.data)}`);
      error.statusCode = 400;
      throw error;
    }

    // 3. Create Subscription in Tilled
    const intervalUnitMap = { MONTH: "month", YEAR: "year" };
    const intervalUnit = intervalUnitMap[plan.interval];
    
    if (!intervalUnit) {
      throw new Error(`Unsupported billing interval: ${plan.interval}`);
    }

    const subscriptionData = {
      billing_cycle_anchor: new Date().toISOString(),
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

    const tilledResponse = await TilledService.createSubscription(subscriptionData, tilledAccountId);

    if (tilledResponse.statusCode >= 400) {
      const error = new Error(`Tilled Subscription Error: ${JSON.stringify(tilledResponse.data)}`);
      error.statusCode = tilledResponse.statusCode;
      throw error;
    }

    const tilledSubscription = tilledResponse.data;

    // 4. Update Database
    const subscriptionDAO = require("../dao/subscription.dao");

    await prisma.$transaction(async (tx) => {
      // Update Payment
      await paymentDAO.updatePayment(tx, payment.id, {
        status: "SUCCEEDED",
        tilledPaymentMethodId: paymentMethodId,
        rawResponse: tilledSubscription,
      });

      // Update Order
      await orderDAO.updateOrder(tx, order.id, {
        status: "COMPLETED", // Completed since it's fully active
      });

      // Upsert Subscription
      const subscription = await subscriptionDAO.upsertSubscription(tx, {
        productId,
        productUserId: productUser.id,
        planId: plan.id,
        tilledSubscriptionId: tilledSubscription.id,
        status: tilledSubscription.status?.toUpperCase() || "ACTIVE",
        currentPeriodStart: new Date(tilledSubscription.billing_cycle_anchor),
        currentPeriodEnd: new Date(tilledSubscription.next_payment_at),
        cancelAtPeriodEnd: false,
        metadata: tilledSubscription,
      });

      // Link subscription to order
      await orderDAO.updateOrder(tx, order.id, { subscriptionId: subscription.id });

      // Update Idempotency Key Status if provided
      if (idempotencyKey) {
        await tx.$executeRaw`
          UPDATE "IdempotencyKey"
          SET "status" = CAST('COMPLETED' AS "IdempotencyStatus"), "updatedAt" = NOW(), "responseStatusCode" = 200
          WHERE "key" = ${idempotencyKey}
        `;
      }
    });

    // 5. Dispatch Webhook
    const webhookDispatcher = require("./webhookDispatcher.service");
    await webhookDispatcher.dispatch(order.id, "subscription.created");

    // We can assume success returns to the user frontend
    return {
      status: "success",
      subscription_status: tilledSubscription.status || "active",
      tilledSubscriptionId: tilledSubscription.id
    };

  } catch (err) {
    console.error("Confirmation Error:", err);
    throw err;
  }
};
