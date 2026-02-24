const prisma = require("../utils/prisma");
const productUserDAO = require("../dao/productUser.dao");
const orderDAO = require("../dao/order.dao");
const paymentDAO = require("../dao/payment.dao");
const refundDAO = require("../dao/refund.dao");

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
    items = [],
    paymentMethod = "CARD"
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
 const { order, payment,duplicate } = await prisma.$transaction(async (tx) => {

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

   if (duplicate) {
   console.log("🔁 Duplicate order detected");

   return {
    ...order,
    payments: order.payments || [],
    __duplicate: true
   };
  }
  //add the tilled calling here 

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


  await refundDAO.updateRefund(null, refund.id, {
    status: "SUCCEEDED",
    tilledRefundId: tilledRefund.id
  });

  return refund;
};