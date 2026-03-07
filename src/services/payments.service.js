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
    extraData = {}
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
      isActive: true
    },
    include: {
      product: true
    }
  });
  if (!plan) {
    console.log("Invalid productPlanId", productPlanId);
    throw new Error("Invalid productPlanId");
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
      resolvedEmail
    );

    const existingOrder = await orderDAO.getOrderByReferenceId(tx, productId, referenceId);

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
          duplicate: false, // Ye naya payment tha. Abhi tak payment create nahi hua tha, to is case me duplicate false hoga.
          productUser,
        };
      }

      // Already paid
      if (latestPayment.status === "SUCCEEDED") {
        return {
          order: existingOrder,
          duplicate: true, // Ye duplicate hai kyunki same referenceId ke saath ek successful payment already exist karta hai. Naya payment create nahi hoga, existing order ko hi reuse karenge.
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
        console.log(`Retrying payment for existing order ${existingOrder.id} with new payment ${newPayment.id}`);
        return {
          order: existingOrder,
          payment: newPayment,
          duplicate: false, // Ye duplicate nahi hai kyunki previous payment failed/cancelled tha, ab naya payment create kar rahe hain. Is case me retry allowed hai aur naya payment create hoga.
          productUser,
        };
      }

      // Fallback: unknown status, treat as duplicate and return latest
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
      planId: plan.id,   //added this as order table expects required relation with plan table for which we need id
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
    return {
      order,
      payment,
      duplicate: false,
      productUser,
    };
  });

  // ==========================================
  // IF DUPLICATE SUCCESS → RETURN
  // ==========================================

  if (result.duplicate) { // Duplicate case me Tilled call nahi karenge, existing order/payment ko hi reuse karenge.
    const latestPayment = result.order.payments?.sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
    )[0];

    return {
      ...result.order,
      payments: latestPayment ? [latestPayment] : [],
      duplicate: true, // Ye duplicate hai kyunki same referenceId ke saath ek payment already exist karta hai. Naya payment create nahi hoga, existing order ko hi reuse karenge.
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
  const resolvedName = data.name || data.user_name || resolvedExternalUserId;

  const existingCustomerId = productUser.tilledCustomerId || extraData?.userTilledId;
  if (existingCustomerId) {
    try {
      const getCustomerResponse = await TilledService.getCustomer(existingCustomerId, targetAccountId);
      if (getCustomerResponse.statusCode >= 200 && getCustomerResponse.statusCode < 300) {
        tilledCustomer = getCustomerResponse.data;
      }
    } catch (error) {
      console.error(`Could not fetch existing Tilled customer ${existingCustomerId}, will create a new one.`);
    }
  }

  if (!tilledCustomer) {
    const tilledCustomerResponse = await TilledService.createCustomer({
      email: resolvedEmail,
      first_name: resolvedName,
      metadata: {
        externalUserId: resolvedExternalUserId,
        productId: productId
      }
    }, targetAccountId);
    tilledCustomer = tilledCustomerResponse.data;

    // Update our DB with this most recent customer ID outside the main transaction
    await productUserDAO.updateTilledCustomerId(null, productUser.id, tilledCustomer.id);
  }

  // 4. Create Tilled Checkout Session
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
    success_url: 'https://payment-pagess.netlify.app/success',
    cancel_url: 'https://payment-pagess.netlify.app/cancelled',
    payment_intent_data: {
      description: `Order ${order.id}`,
      setup_future_usage: "off_session",
      payment_method_types: ["card"],
      ...(platformFee && { platform_fee_amount: platformFee })
    },
    metadata: tilledMetadata
  }, targetAccountId);

  console.log("Checkout Session Response:", checkoutSessionResponse);

  const checkoutSession = checkoutSessionResponse.data;

  if (checkoutSessionResponse.statusCode >= 400) {
    throw new Error(`Tilled Error: ${checkoutSession.message || checkoutSession.error || 'Failed to create checkout session'}`);
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: "PROCESSING",
      tilledPaymentId: checkoutSession.payment_intent_id
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
 * GET PAYMENTS
 */
exports.getPayments = async (productId, query = {}) => {
  return await orderDAO.getOrders(null, { ...query, productId });
};

/**
 * GET PAYMENT BY ID
 */
exports.getPaymentById = async (productId, id) => {
  return await orderDAO.getOrderByIdAndProduct(null, id, productId, {
    items: true,
    payments: true,
    productUser: true,
  });
};

/**
 * REFUND PAYMENT
 *
 * State Machine:
 * 1️⃣ Validate balance
 * 2️⃣ Create Refund(PENDING)
 * 3️⃣ Commit
 * 4️⃣ Call Tilled
 * 5️⃣ Finalize SUCCEEDED / FAILED
 */
exports.refundPayment = async (
  productId,
  orderId,
  refundData,
  options = {},
) => {
  const { idempotencyKey } = options;
  const { amount, reason } = refundData;

  if (!amount || amount <= 0) {
    const error = new Error("Invalid refund amount");
    error.statusCode = 400;
    throw error;
  }

  const { refund, payment } = await prisma.$transaction(async (tx) => {
    const order = await orderDAO.getOrderByIdAndProduct(
      tx,
      orderId,
      productId,
      { payments: true, refunds: true },
    );

    if (!order) {
      const error = new Error("Order not found");
      error.statusCode = 404;
      throw error;
    }

    const successfulPayment = order.payments.find(
      (p) => p.status === "SUCCEEDED",
    );

    if (!successfulPayment) {
      const error = new Error("No successful payment found");
      error.statusCode = 400;
      throw error;
    }

    const totalRefunded = successfulPayment.refunds.reduce(
      (sum, r) => sum + r.amount,
      0,
    );

    if (amount > successfulPayment.amount - totalRefunded) {
      const error = new Error("Refund exceeds available balance");
      error.statusCode = 400;
      throw error;
    }

    const refund = await refundDAO.createRefund(tx, {
      paymentId: successfulPayment.id,
      amount,
      reason,
      status: "PENDING",
    });

    return { refund, payment: successfulPayment };
  });

  // TILLED TEAM: Implement actual Tilled API call here
  // const tilledRefund = await TilledService.refundPayment(...);

  await refundDAO.updateRefund(null, refund.id, {
    status: "SUCCEEDED",
    tilledRefundId: "simulated_tilled_refund_id",
  });

  return refund;
};
