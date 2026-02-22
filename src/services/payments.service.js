const prisma = require("../utils/prisma");
const productUserDAO = require("../dao/productUser.dao");
const orderDAO = require("../dao/order.dao");
const paymentDAO = require("../dao/payment.dao");
const auditService = require("./audit.service");

/**
 * Create a new payment/order
 */
exports.createPayment = async (productId, data) => {
  return prisma.$transaction(async (tx) => {
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
      throw new Error(
        "Missing required fields: externalUserId, referenceId, amount"
      );
    }

    const productUser = await productUserDAO.upsertProductUser(
      tx,
      productId,
      externalUserId,
      email
    );

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

    // 🔥 Audit Log
    await auditService.log({
      userId: productUser.id,
      userName: productUser.email,
      paymentStatus: "CREATED",
      eventType: "ORDER_CREATED",
      status: "SUCCESS",
      productId,
      orderId: order.id,
      paymentId: payment.id,
      metadata: { amount }
    });

    return {
      ...order,
      payments: [payment]
    };
  });
};

/**
 * Process a charge
 */
exports.processCharge = async (orderId, chargeData) => {
  return prisma.$transaction(async (tx) => {
    const { tilledPaymentId, rawRequest, rawResponse } = chargeData;

    const order = await orderDAO.getOrderById(tx, orderId, {
      payments: true
    });

    if (!order) {
      throw new Error("Order not found");
    }

    if (order.status === "PAID") {
      throw new Error("Order already paid");
    }

    let payment = order.payments.find(p => p.status === "INITIATED");

    if (!payment) {
      payment = await paymentDAO.createPayment(tx, {
        orderId: order.id,
        method: "CARD",
        status: "PROCESSING",
        amount: order.amount
      });
    }

    const updatedPayment = await paymentDAO.updatePayment(tx, payment.id, {
      tilledPaymentId,
      status: "PROCESSING",
      rawRequest,
      rawResponse
    });

    await orderDAO.updateOrder(tx, orderId, { status: "PENDING" });

    await auditService.log({
      eventType: "PAYMENT_INITIATED",
      status: "SUCCESS",
      orderId,
      paymentId: updatedPayment.id,
      paymentStatus: "PROCESSING"
    });

    return updatedPayment;
  });
};

/**
 * Mark payment as succeeded
 */
exports.markPaymentSucceeded = async (paymentId, tilledData = {}) => {
  return prisma.$transaction(async (tx) => {
    const payment = await paymentDAO.updatePayment(tx, paymentId, {
      status: "SUCCEEDED",
      rawResponse: tilledData
    });

    await orderDAO.updateOrder(tx, payment.orderId, { status: "PAID" });

    await auditService.log({
      eventType: "PAYMENT_SUCCEEDED",
      status: "SUCCESS",
      orderId: payment.orderId,
      paymentId: payment.id,
      paymentStatus: "SUCCEEDED"
    });

    return payment;
  });
};

/**
 * Mark payment as failed
 */
exports.markPaymentFailed = async (paymentId) => {
  return prisma.$transaction(async (tx) => {
    const payment = await paymentDAO.updatePayment(tx, paymentId, {
      status: "FAILED"
    });

    await orderDAO.updateOrder(tx, payment.orderId, { status: "FAILED" });

    await auditService.log({
      eventType: "PAYMENT_FAILED",
      status: "FAILED",
      orderId: payment.orderId,
      paymentId: payment.id,
      paymentStatus: "FAILED"
    });

    return payment;
  });
};

/**
 * Process a refund
 */
exports.refundPayment = async (productId, orderId, refundData) => {
  return prisma.$transaction(async (tx) => {
    const { amount, reason, tilledRefundId } = refundData;
    const refundDAO = require("../dao/refund.dao");

    const order = await orderDAO.getOrderByIdAndProduct(
      tx,
      orderId,
      productId,
      { payments: true, refunds: true }
    );

    if (!order) {
      throw new Error("Order not found");
    }

    if (order.status !== "PAID") {
      throw new Error("Only paid orders can be refunded");
    }

    const successfulPayment = order.payments.find(
      p => p.status === "SUCCEEDED"
    );

    if (!successfulPayment) {
      throw new Error("No successful payment found for this order");
    }

    const totalRefunded = successfulPayment.refunds.reduce(
      (sum, refund) => sum + refund.amount,
      0
    );

    if (amount > successfulPayment.amount - totalRefunded) {
      throw new Error("Refund amount exceeds available balance");
    }

    const refund = await refundDAO.createRefund(tx, {
      paymentId: successfulPayment.id,
      tilledRefundId,
      amount,
      reason,
      status: "PENDING"
    });

    await auditService.log({
      eventType: "REFUND_INITIATED",
      status: "SUCCESS",
      orderId,
      paymentId: successfulPayment.id,
      refundId: refund.id,
      paymentStatus: "PARTIAL_REFUND",
      metadata: { amount, reason }
    });

    return refund;
  });
};