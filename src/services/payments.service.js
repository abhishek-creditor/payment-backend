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
      amount: rawAmount,
      currency = "cad",
      items = [],
      paymentMethod = "CARD",
      tilledAccountId // New field for author payouts
    } = data;

    const amount = parseInt(rawAmount);

    // Validate required fields
    if (!externalUserId || !referenceId || isNaN(amount)) {
      throw new Error("Missing required fields: externalUserId, referenceId, amount");
    }

    // 1. Create or get product user
    let productUser = await productUserDAO.upsertProductUser(tx, productId, externalUserId, email);

    // 2. Check for duplicate using idempotency key
    if (idempotencyKey) {
      const existingOrder = await orderDAO.getOrderByIdempotencyKey(tx, idempotencyKey);

      if (existingOrder) {
        // Return existing order instead of creating duplicate
        return existingOrder;
      }
    }

    // 3. Create or get Tilled Customer
    // NOTE: Tilled customers are scoped to the Tilled Account. 
    // If tilledAccountId is provided (author), we must create/check customer ON THAT ACCOUNT.
    // Our DB only stores one tilledCustomerId per ProductUser. 
    // If a user buys from multiple authors (accounts), they need a customer record on EACH.
    // LIMITATION: Current schema only stores ONE `tilledCustomerId`. 
    // WORKAROUND: For now, we'll just try to use what we have or create new. 
    // Ideally, `ProductUser` should have `tilledCustomerIds` map or a separate table.
    // Given instructions, we will just proceed with passing the account ID. 
    // If the existing ID is for a different account, Tilled might 404. 
    // We'll proceed assuming single-tenant or handled downstream for now.

    // Actually, if tilledAccountId is passed, we should probably ALWAYS check/create 
    // because the cached ID might be for the platform account.

    // Create customer in Tilled (idempotent-ish if we store it)
    const TilledService = require("./tilled.service");

    // We'll update the customer ID *if* we are creating a new one or overriding.
    // If we assume the user might have different IDs for different authors, we can't overwrite blindly
    // without losing the previous one. 
    // BUT the prompt implies specific author payment.

    // Strategy: Try to creating/getting the customer on the target account.
    const tilledCustomerResponse = await TilledService.createCustomer({
      email: email,
      first_name: externalUserId,
      metadata: {
        externalUserId: externalUserId,
        productId: productId
      }
    }, tilledAccountId || process.env.TILLED_SANDBOX_ACCOUNT_ID);
    const tilledCustomer = tilledCustomerResponse.data;

    // Update our DB with this most recent customer ID
    productUser = await productUserDAO.updateTilledCustomerId(tx, productUser.id, tilledCustomer.id);


    // 4. Create order with items
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
      if (idempotencyKey && e && e.code === "P2002") {
        const existingOrder = await orderDAO.getOrderByIdempotencyKey(tx, idempotencyKey);
        if (existingOrder) return existingOrder;
      }
      throw e;
    }

    // 5. Create Tilled Checkout Session
    let lineItems = [];
    if (items && items.length > 0) {
      lineItems = items.map(item => ({
        price_data: {
          currency: currency,
          product_data: {
            name: item.name
          },
          unit_amount: item.price
        },
        quantity: item.quantity || 1
      }));
    } else {
      lineItems = [{
        price_data: {
          currency: currency,
          product_data: {
            name: data.bookTitle || "Order Payment"
          },
          unit_amount: amount
        },
        quantity: 1
      }];
    }

    const checkoutSessionResponse = await TilledService.createCheckoutSession({
      customer_id: tilledCustomer.id, // Use the one we just ensured exists on this account
      line_items: lineItems,
      mode: 'payment',
      success_url: `https://www.example.com/success`, // TODO: Get from config
      cancel_url: `https://www.example.com/cancel`, // TODO: Get from config
      payment_intent_data: {
        description: "Order #123456",
        payment_method_types: ["card"]
      },
      metadata: {
        orderId: order.id,
        productId: productId
      }
    }, tilledAccountId || process.env.TILLED_SANDBOX_ACCOUNT_ID); // Pass the author's account ID
    const checkoutSession = checkoutSessionResponse.data;

    // 6. Create initial payment record
    const payment = await paymentDAO.createPayment(tx, {
      orderId: order.id,
      amount: amount,
      method: paymentMethod,
      status: "INITIATED",
      tilledPaymentId: checkoutSession.payment_intent, // If checkout session returns this locally
      rawResponse: checkoutSession
    });

    if (checkoutSessionResponse.statusCode >= 400) {
      throw new Error(`Tilled Error: ${checkoutSession.message || checkoutSession.error || 'Failed to create checkout session'}`);
    }

    // 7. Return order with checkout URL
    return {
      ...order,
      payments: [payment],
      checkoutUrl: checkoutSession.url
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