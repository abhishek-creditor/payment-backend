const { log } = require("node:console");
const service = require("../services/payments.service");

/**
 * CREATE PAYMENT
 * POST /api/payments
 * MOHD SHAHAVEZ CHANGE CREATE PAYMENT FUNC FOR CORRECT STATUS FUNCTIONALITY WITH MIDDLEWARE
 */
exports.createPayment = async (req, res) => {
  try {
    const payment = await service.createPayment(
      req.productId,
      req.body,
      {
        idempotencyKey: req.idempotencyKey, // Forwarded from middleware
      }
    );

    // Extract latest payment status safely
    const paymentStatus =
      payment?.payments?.[0]?.status || null;

    // HTTP status logic
    const httpStatus = payment.duplicate ? 200 : 201;

    return res.status(httpStatus).json({
      success: true,
      status: paymentStatus, // 👈 Important for middleware mapping
      duplicate: payment.duplicate || false,
      checkoutUrl: payment.checkoutUrl || null,
      data: payment,
    });

  } catch (error) {
    console.error("Create Payment Error:", error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to create payment",
    });
  }
};

/**
 * CONFIRM PAYMENT
 * POST /api/payments/confirm
 */
exports.confirmPayment = async (req, res) => {
  try {
    const { orderId, payment_method_id, tilledAccountId } = req.body;

    // For delegate keys, the backend needs an explicit product hint so it can
    // resolve the correct product context (otherwise it falls back to the key's
    // default productId and can mismatch an order created under another product).
    const isDelegate = Array.isArray(req.apiKey?.permissions) && req.apiKey.permissions.includes("delegate");
    if (isDelegate && !req.body?.productId && !req.body?.productCode) {
      return res.status(400).json({
        success: false,
        message: "Missing productId (or productCode) for delegate API key. Send the order's productId in the confirm request body.",
      });
    }

    const result = await service.confirmSubscriptionPayment(
      req.productId,
      orderId,
      payment_method_id,
      tilledAccountId,
      {
        idempotencyKey: req.idempotencyKey,
        apiKeyPermissions: req.apiKey?.permissions,
        apiKeyPrefix: req.apiKey?.keyPrefix,
      }
    );

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Confirm Payment Error:", error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to confirm payment",
    });
  }
};

// GET ORDER STATUS
// GET /api/payments/status

exports.getOrderStatus = async (req, res) => {
  try {
    const { orderId } = req.query;

    console.log("---- Fetching Order Status ----");
    console.log("Query Params:", { orderId });

    if (!orderId) {
      console.warn("Validation Error: Missing orderId");
      return res.status(400).json({
        success: false,
        message: "orderId is required"
      });
    }

    const statusData = await service.getOrderStatus(req.productId, orderId);
    console.log("Product Id: ", req.productId + " --> " + orderId);

    return res.status(200).json({
      success: true,
      data: statusData
    });

  } catch (error) {
    console.error("Get Order Status Error:", error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to fetch order status"
    });
  }
};

/**
 * GET ALL PAYMENTS
 * GET /api/payments
 */
exports.getPayments = async (req, res) => {
  try {
    const payments = await service.getPayments(
      req.productId,
      req.query
    );

    return res.status(200).json({
      success: true,
      data: payments
    });

  } catch (error) {
    console.error("Get Payments Error:", error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to fetch payments"
    });
  }
};


/**
 * GET SINGLE PAYMENT
 * GET /api/payments/:id
 */
exports.getPaymentById = async (req, res) => {
  try {
    const { id } = req.params;

    const payment = await service.getPaymentById(
      req.productId,
      id
    );

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment not found"
      });
    }

    return res.status(200).json({
      success: true,
      data: payment
    });

  } catch (error) {
    console.error("Get Payment Error:", error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to fetch payment"
    });
  }
};


/**
 * REFUND PAYMENT
 * POST /api/payments/:id/refund
 */
exports.refundPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, reason } = req.body;

    if (!amount) {
      return res.status(400).json({
        success: false,
        message: "Refund amount is required"
      });
    }

    const refund = await service.refundPayment(
      req.productId,
      id,
      { amount, reason },
      {
        idempotencyKey: req.idempotencyKey // Forwarded
      }
    );

    return res.status(200).json({
      success: true,
      data: refund
    });

  } catch (error) {
    console.error("Refund Error:", error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to process refund"
    });
  }
};