const prisma = require("../utils/prisma");
const productUserDAO = require("../dao/productUser.dao");
const orderDAO = require("../dao/order.dao");
const paymentDAO = require("../dao/payment.dao");

/**
 * Create a new payment/order
 */
exports.createPayment = async (productId, data) => {
  return prisma.$transaction(async (tx) => {
    const {
      externalUserId,
      email,
      referenceId,
      idempotencyKey,
      amount,
      currency = "USD",
      items = [],
      paymentMethod = "CARD"
    } = data;

    // Validate required fields
    if (!externalUserId || !referenceId || !amount) {
      throw new Error("Missing required fields: externalUserId, referenceId, amount");
    }

    // 1. Create or get product user
    const productUser = await productUserDAO.upsertProductUser(tx, productId, externalUserId, email);

    // 2. Check for duplicate using idempotency key
    if (idempotencyKey) {
      const existingOrder = await orderDAO.getOrderByIdempotencyKey(tx, idempotencyKey);

      if (existingOrder) {
        // Return existing order instead of creating duplicate
        return existingOrder;
      }
    }

    // 3. Create order with items
    let order;
    try {
      order = await orderDAO.createOrder(tx, {
        productId,
        productUserId: productUser.id,
        referenceId,
        idempotencyKey,
        amount,
        currency,
        status: "CREATED",
        items
      });
    } catch (e) {
      // If two concurrent requests race, the DB unique constraint wins.
      if (idempotencyKey && e && e.code === "P2002") {
        const existingOrder = await orderDAO.getOrderByIdempotencyKey(tx, idempotencyKey);
        if (existingOrder) return existingOrder;
      }
      throw e;
    }

    // 4. Create initial payment record (if needed)
    // Note: You might want to create this when actually charging
    // For now, we'll create it in INITIATED status
    const payment = await paymentDAO.createPayment(tx, {
      orderId: order.id,
      method: paymentMethod,
      status: "INITIATED",
      amount: amount
    });

    // 5. Return order with payment info
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
 * Process a charge (update payment to processing/succeeded)
 */
exports.processCharge = async (orderId, chargeData) => {
  return prisma.$transaction(async (tx) => {
    const { tilledPaymentId, rawRequest, rawResponse } = chargeData;

    // Get the order
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

    // Find the initiated payment or create new one
    let payment = order.payments.find(p => p.status === "INITIATED");

    if (!payment) {
      payment = await paymentDAO.createPayment(tx, {
        orderId: order.id,
        method: "CARD",
        status: "PROCESSING",
        amount: order.amount
      });
    }

    // Update payment with Tilled info
    const updatedPayment = await paymentDAO.updatePayment(tx, payment.id, {
      tilledPaymentId,
      status: "PROCESSING",
      rawRequest,
      rawResponse
    });

    // Update order status
    await orderDAO.updateOrder(tx, orderId, { status: "PENDING" });

    return updatedPayment;
  });
};

/**
 * Mark payment as succeeded
 */
exports.markPaymentSucceeded = async (paymentId, tilledData = {}) => {
  return prisma.$transaction(async (tx) => {
    // Update payment
    const payment = await paymentDAO.updatePayment(tx, paymentId, {
      status: "SUCCEEDED",
      rawResponse: tilledData
    });

    // Update order status
    await orderDAO.updateOrder(tx, payment.orderId, { status: "PAID" });

    return payment;
  });
};

/**
 * Mark payment as failed
 */
exports.markPaymentFailed = async (paymentId, errorMessage) => {
  return prisma.$transaction(async (tx) => {
    // Update payment
    const payment = await paymentDAO.updatePayment(tx, paymentId, {
      status: "FAILED"
    });

    // Update order status
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

    // Get the order with payments
    const order = await orderDAO.getOrderByIdAndProduct(tx, orderId, productId, {
      items: false,
      payments: true,
      refunds: true,
      productUser: false
    });

    if (!order) {
      throw new Error("Order not found");
    }

    if (order.status !== "PAID") {
      throw new Error("Only paid orders can be refunded");
    }

    // Get the successful payment
    const successfulPayment = order.payments.find(
      p => p.status === "SUCCEEDED"
    );

    if (!successfulPayment) {
      throw new Error("No successful payment found for this order");
    }

    // Calculate total refunded amount
    const totalRefunded = successfulPayment.refunds.reduce(
      (sum, refund) => sum + refund.amount,
      0
    );

    // Validate refund amount
    if (amount > (successfulPayment.amount - totalRefunded)) {
      throw new Error("Refund amount exceeds available balance");
    }

    // Create refund record
    const refund = await refundDAO.createRefund(tx, {
      paymentId: successfulPayment.id,
      tilledRefundId,
      amount,
      reason,
      status: "PENDING"
    });

    // Update order status if full refund
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
 * Get order by reference ID (from external system)
 */
exports.getOrderByReferenceId = async (productId, referenceId) => {
  return orderDAO.getOrderByReferenceId(null, productId, referenceId);
};