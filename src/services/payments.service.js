const prisma = require("../utils/prisma");
const productUserDAO = require("../dao/productUser.dao");
const orderDAO = require("../dao/order.dao");
const paymentDAO = require("../dao/payment.dao");

/**
 * Create a new payment/order
 * Idempotency is fully handled by middleware
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

    // Validate required fields
    if (!externalUserId || !referenceId || !amount) {
      throw new Error(
        "Missing required fields: externalUserId, referenceId, amount"
      );
    }

    // 1️⃣ Create or get product user
    const productUser = await productUserDAO.upsertProductUser(
      tx,
      productId,
      externalUserId,
      email
    );

    // 2️⃣ Create order (NO idempotency logic here)
    const order = await orderDAO.createOrder(tx, {
      productId,
      productUserId: productUser.id,
      referenceId,
      amount,
      currency,
      status: "CREATED",
      items
    });

    // 3️⃣ Create initial payment record
    const payment = await paymentDAO.createPayment(tx, {
      orderId: order.id,
      method: paymentMethod,
      status: "INITIATED",
      amount
    });

    return {
      ...order,
      payments: [payment]
    };
  });
};

/**
 * Get all payments/orders for a product
 */
exports.getPayments = async (productId, queryParams = {}) => {
  return orderDAO.getOrders(null, {
    productId,
    ...queryParams
  });
};

/**
 * Get a specific payment/order by ID
 */
exports.getPaymentById = async (productId, orderId) => {
  return orderDAO.getOrderByIdAndProduct(null, orderId, productId, {
    items: true,
    payments: true,
    refunds: true,
    productUser: true
  });
};

/**
 * Update order status
 */
exports.updateOrderStatus = async (orderId, status) => {
  return orderDAO.updateOrderStatus(null, orderId, status);
};

/**
 * Process a charge
 */
exports.processCharge = async (orderId, chargeData) => {
  return prisma.$transaction(async (tx) => {
    const { tilledPaymentId, rawRequest, rawResponse } = chargeData;

    const order = await orderDAO.getOrderById(tx, orderId, {
      payments: true,
      items: false,
      productUser: false
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
      {
        payments: true,
        refunds: true
      }
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

    const newTotalRefunded = totalRefunded + amount;

    if (newTotalRefunded === successfulPayment.amount) {
      await orderDAO.updateOrder(tx, orderId, { status: "REFUNDED" });
    }

    return refund;
  });
};

/**
 * Update refund status
 */
exports.updateRefundStatus = async (refundId, status) => {
  const refundDAO = require("../dao/refund.dao");
  return refundDAO.updateRefundStatus(null, refundId, status);
};

/**
 * Get order by reference ID
 */
exports.getOrderByReferenceId = async (productId, referenceId) => {
  return orderDAO.getOrderByReferenceId(null, productId, referenceId);
};