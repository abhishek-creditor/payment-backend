const prisma = require("../utils/prisma");
const productUserDAO = require("../dao/productUser.dao");
const orderDAO = require("../dao/order.dao");
const paymentDAO = require("../dao/payment.dao");
const refundDAO = require("../dao/refund.dao");

// Assume Tilled SDK instance
const tilled = require("../utils/tilled");

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
    amount,
    currency = "USD",
    items = [],
    paymentMethod = "CARD"
  } = data;

  if (!externalUserId || !referenceId || !amount) {
    const error = new Error(
      "Missing required fields: externalUserId, referenceId, amount"
    );
    error.statusCode = 400;
    throw error;
  }

  if (amount <= 0) {
    const error = new Error("Amount must be greater than zero");
    error.statusCode = 400;
    throw error;
  }

  // ---------------------------
  // STEP 1: DB TRANSACTION
  // ---------------------------
  const { order, payment } = await prisma.$transaction(async (tx) => {

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
        payment: existingOrder.payments?.[0] || null,
        duplicate: true
      };
    }

    const order = await orderDAO.createOrder(tx, {
      productId,
      productUserId: productUser.id,
      referenceId,
      amount,
      currency,
      status: "CREATED",
      items
    });

    const payment = await paymentDAO.createPayment(tx, {
      orderId: order.id,
      method: paymentMethod,
      status: "INITIATED",
      amount
    });

    return { order, payment, duplicate: false };
  });

  if (!payment) {
    return { ...order, __duplicate: true };
  }

  // ---------------------------
  // STEP 2: CALL TILLED (OUTSIDE TX)
  // ---------------------------
  let tilledResponse;

  try {
    tilledResponse = await tilled.paymentIntents.create(
      {
        amount,
        currency,
        metadata: {
          orderId: order.id,
          referenceId
        }
      },
      {
        headers: {
          "Idempotency-Key": idempotencyKey
        }
      }
    );
  } catch (error) {

    await paymentDAO.updatePayment(null, payment.id, {
      status: "FAILED",
      rawResponse: error.response || null
    });

    throw error;
  }

  // ---------------------------
  // STEP 3: UPDATE FINAL STATE
  // ---------------------------

  let finalStatus;

  if (tilledResponse.status === "succeeded") {
    finalStatus = "SUCCEEDED";
  } 
  else if (
    tilledResponse.status === "INITIATED" ||
    tilledResponse.status === "requires_payment_method" ||
    tilledResponse.status === "requires_confirmation"
  ) {
    finalStatus = "INITIATED";
  } 
  else {
    finalStatus = "FAILED";
  }

  let orderStatus;

  if (finalStatus === "SUCCEEDED") {
    orderStatus = "PAID";
  } 
  else if (finalStatus === "INITIATED") {
    orderStatus = "PENDING";
  } 
  else {
    orderStatus = "FAILED";
  }

  await prisma.$transaction(async (tx) => {

    await paymentDAO.updatePayment(tx, payment.id, {
      status: finalStatus,
      tilledPaymentId: tilledResponse.id,
      rawResponse: tilledResponse
    });

    await orderDAO.updateOrderStatus(tx, order.id, orderStatus);

  });

  return {
    ...order,
    payments: [{
      ...payment,
      status: finalStatus
    }]
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

  let tilledRefund;

  try {
    tilledRefund = await tilled.refunds.create(
      {
        payment_intent: payment.tilledPaymentId,
        amount,
        reason
      },
      {
        headers: {
          "Idempotency-Key": idempotencyKey
        }
      }
    );
  } catch (error) {

    await refundDAO.updateRefund(null, refund.id, {
      status: "FAILED"
    });

    throw error;
  }

  await refundDAO.updateRefund(null, refund.id, {
    status: "SUCCEEDED",
    tilledRefundId: tilledRefund.id
  });

  return refund;
};