const prisma = require("../utils/prisma");

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
    const productUser = await tx.productUser.upsert({
      where: {
        productId_externalUserId: {
          productId,
          externalUserId
        }
      },
      update: {
        email: email || undefined
      },
      create: {
        productId,
        externalUserId,
        email
      }
    });

    // 2. Check for duplicate using idempotency key
    if (idempotencyKey) {
      const existingOrder = await tx.order.findUnique({
        where: { idempotencyKey },
        include: {
          items: true,
          payments: true
        }
      });

      if (existingOrder) {
        // Return existing order instead of creating duplicate
        return existingOrder;
      }
    }

    // 3. Create order with items
    const order = await tx.order.create({
      data: {
        productId,
        productUserId: productUser.id,
        referenceId,
        idempotencyKey,
        amount,
        currency,
        status: "CREATED",
        items: {
          create: items.map(item => ({
            name: item.name,
            sku: item.sku || null,
            quantity: item.quantity || 1,
            price: item.price
          }))
        }
      },
      include: {
        items: true,
        productUser: {
          select: {
            id: true,
            externalUserId: true,
            email: true
          }
        }
      }
    });

    // 4. Create initial payment record (if needed)
    // Note: You might want to create this when actually charging
    // For now, we'll create it in INITIATED status
    const payment = await tx.payment.create({
      data: {
        orderId: order.id,
        method: paymentMethod,
        status: "INITIATED",
        amount: amount
      }
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
  const { 
    page = 1, 
    limit = 10, 
    status,
    startDate,
    endDate
  } = queryParams;

  const where = { productId };

  // Add status filter if provided
  if (status) {
    where.status = status;
  }

  // Add date range filter if provided
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) where.createdAt.lte = new Date(endDate);
  }

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: {
        items: true,
        payments: {
          include: {
            refunds: true
          }
        },
        productUser: {
          select: {
            externalUserId: true,
            email: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip: (parseInt(page) - 1) * parseInt(limit),
      take: parseInt(limit)
    }),
    prisma.order.count({ where })
  ]);

  return {
    orders,
    pagination: {
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / parseInt(limit))
    }
  };
};

/**
 * Get a specific payment/order by ID
 */
exports.getPaymentById = async (productId, orderId) => {
  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      productId // Ensure it belongs to this product
    },
    include: {
      items: true,
      payments: {
        include: {
          refunds: true
        }
      },
      productUser: {
        select: {
          externalUserId: true,
          email: true
        }
      }
    }
  });

  return order;
};

/**
 * Update order status
 */
exports.updateOrderStatus = async (orderId, status) => {
  return prisma.order.update({
    where: { id: orderId },
    data: { status },
    include: {
      items: true,
      payments: true
    }
  });
};

/**
 * Process a charge (update payment to processing/succeeded)
 */
exports.processCharge = async (orderId, chargeData) => {
  return prisma.$transaction(async (tx) => {
    const { tilledPaymentId, rawRequest, rawResponse } = chargeData;

    // Get the order
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { payments: true }
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
      payment = await tx.payment.create({
        data: {
          orderId: order.id,
          method: "CARD",
          status: "PROCESSING",
          amount: order.amount
        }
      });
    }

    // Update payment with Tilled info
    const updatedPayment = await tx.payment.update({
      where: { id: payment.id },
      data: {
        tilledPaymentId,
        status: "PROCESSING",
        rawRequest,
        rawResponse
      }
    });

    // Update order status
    await tx.order.update({
      where: { id: orderId },
      data: { status: "PENDING" }
    });

    return updatedPayment;
  });
};

/**
 * Mark payment as succeeded
 */
exports.markPaymentSucceeded = async (paymentId, tilledData = {}) => {
  return prisma.$transaction(async (tx) => {
    // Update payment
    const payment = await tx.payment.update({
      where: { id: paymentId },
      data: {
        status: "SUCCEEDED",
        rawResponse: tilledData
      },
      include: {
        order: true
      }
    });

    // Update order status
    await tx.order.update({
      where: { id: payment.orderId },
      data: { status: "PAID" }
    });

    return payment;
  });
};

/**
 * Mark payment as failed
 */
exports.markPaymentFailed = async (paymentId, errorMessage) => {
  return prisma.$transaction(async (tx) => {
    // Update payment
    const payment = await tx.payment.update({
      where: { id: paymentId },
      data: {
        status: "FAILED"
      },
      include: {
        order: true
      }
    });

    // Update order status
    await tx.order.update({
      where: { id: payment.orderId },
      data: { status: "FAILED" }
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

    // Get the order with payments
    const order = await tx.order.findFirst({
      where: {
        id: orderId,
        productId
      },
      include: {
        payments: {
          include: {
            refunds: true
          }
        }
      }
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
    const refund = await tx.refund.create({
      data: {
        paymentId: successfulPayment.id,
        tilledRefundId,
        amount,
        reason,
        status: "PENDING"
      }
    });

    // Update order status if full refund
    const newTotalRefunded = totalRefunded + amount;
    if (newTotalRefunded === successfulPayment.amount) {
      await tx.order.update({
        where: { id: orderId },
        data: { status: "REFUNDED" }
      });
    }

    return refund;
  });
};

/**
 * Update refund status
 */
exports.updateRefundStatus = async (refundId, status) => {
  return prisma.refund.update({
    where: { id: refundId },
    data: { status },
    include: {
      payment: {
        include: {
          order: true
        }
      }
    }
  });
};

/**
 * Get order by reference ID (from external system)
 */
exports.getOrderByReferenceId = async (productId, referenceId) => {
  return prisma.order.findFirst({
    where: {
      productId,
      referenceId
    },
    include: {
      items: true,
      payments: {
        include: {
          refunds: true
        }
      },
      productUser: true
    }
  });
};