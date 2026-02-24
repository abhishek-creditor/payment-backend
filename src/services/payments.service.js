const prisma = require("../utils/prisma");
const productUserDAO = require("../dao/productUser.dao");
const orderDAO = require("../dao/order.dao");
const paymentDAO = require("../dao/payment.dao");
const refundDAO = require("../dao/refund.dao");
const TilledService = require("./tilled.service");

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
    email,
    referenceId,
    plan_code,
    paymentMethod = "CARD",
    tilledAccountId
  } = data;
  const normalizedPlanCode = String(plan_code).trim();
  const plan = await prisma.productPlan.findFirst({
    where: {
      productId,
      code: normalizedPlanCode,
      isActive: true
    }
  });
  if (!plan) {
    throw new Error("Invalid plan_code");
  }
  if (!plan.price || !plan.currency) {
    throw new Error("Invalid plan configuration");
  }
  const amount = plan.price;
  const currency = plan.currency;

  // ---------------------------
  // STEP 1: DB TRANSACTION
  // ---------------------------
  const { order, payment, duplicate, productUser } = await prisma.$transaction(async (tx) => {

    const productUser = await productUserDAO.upsertProductUser(
      tx,
      productId,
      externalUserId,
      email
    );

    const existingOrder = await orderDAO.getOrderByReferenceId(
      tx,
      productId,
      referenceId
    );

    if (existingOrder) {
      return {
        order: existingOrder,
        duplicate: true
      };
    }

    const order = await orderDAO.createOrder(tx, {
      productId,
      productUserId: productUser.id,
      planId: plan.id,
      referenceId,
      amount,
      currency,
      status: "CREATED",
      items: [{
        name: plan.name,
        price: amount,
        quantity: 1
      }]
    });

    const payment = await paymentDAO.createPayment(tx, {
      orderId: order.id,
      amount: amount,
      method: paymentMethod,
      status: "INITIATED"
    });

    return { order, payment, duplicate: false, productUser };
  });

  if (duplicate) {
    console.log("🔁 Duplicate order detected");

    return {
      ...order,
      payments: order.payments || [],
      __duplicate: true
    };
  }
  // 3. Create or get Tilled Customer
  let tilledCustomer = null;
  const targetAccountId = tilledAccountId || process.env.TILLED_SANDBOX_ACCOUNT_ID;

  if (productUser.tilledCustomerId) {
    try {
      const getCustomerResponse = await TilledService.getCustomer(productUser.tilledCustomerId, targetAccountId);
      if (getCustomerResponse.statusCode >= 200 && getCustomerResponse.statusCode < 300) {
        tilledCustomer = getCustomerResponse.data;
      }
    } catch (error) {
      console.error(`Could not fetch existing Tilled customer ${productUser.tilledCustomerId}, will create a new one.`);
    }
  }

  if (!tilledCustomer) {
    const tilledCustomerResponse = await TilledService.createCustomer({
      email: email,
      first_name: externalUserId,
      metadata: {
        externalUserId: externalUserId,
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

  const checkoutSessionResponse = await TilledService.createCheckoutSession({
    customer_id: tilledCustomer.id,
    line_items: lineItems,
    mode: 'payment',
    success_url: process.env.CLIENT_SUCCESS_URL || `https://www.example.com/success`,
    cancel_url: process.env.CLIENT_CANCEL_URL || `https://www.example.com/cancel`,
    payment_intent_data: {
      description: `Order ${order.id}`,
      setup_future_usage: "off_session",
      payment_method_types: ["card"]
    },
    metadata: {
      orderId: order.id,
      productId: productId
    }
  }, targetAccountId);

  const checkoutSession = checkoutSessionResponse.data;

  if (checkoutSessionResponse.statusCode >= 400) {
    throw new Error(`Tilled Error: ${checkoutSession.message || checkoutSession.error || 'Failed to create checkout session'}`);
  }

  // Update payment record with Tilled info
  await paymentDAO.updatePayment(null, payment.id, {
    tilledPaymentId: checkoutSession.payment_intent,
    rawResponse: checkoutSession
  });

  return {
    ...order,
    payments: [{
      ...payment,
      tilledPaymentId: checkoutSession.payment_intent,
      status: "INITIATED",
      rawResponse: checkoutSession
    }],
    checkoutUrl: checkoutSession.url
  };
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
  options = {}
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
      { payments: true, refunds: true }
    );

    if (!order) {
      const error = new Error("Order not found");
      error.statusCode = 404;
      throw error;
    }

    const successfulPayment = order.payments.find(
      (p) => p.status === "SUCCEEDED"
    );

    if (!successfulPayment) {
      const error = new Error("No successful payment found");
      error.statusCode = 400;
      throw error;
    }

    const totalRefunded = successfulPayment.refunds.reduce(
      (sum, r) => sum + r.amount,
      0
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
      status: "PENDING"
    });

    return { refund, payment: successfulPayment };
  });


  await refundDAO.updateRefund(null, refund.id, {
    status: "SUCCEEDED",
    tilledRefundId: tilledRefund.id
  });

  return refund;
};