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
    
    const result = await service.confirmSubscriptionPayment(
      req.productId,
      orderId,
      payment_method_id,
      tilledAccountId,
      {
        idempotencyKey: req.idempotencyKey,
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