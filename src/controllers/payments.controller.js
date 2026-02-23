const service = require("../services/payments.service");

/**
 * CREATE PAYMENT
 * POST /api/payments
 */
exports.createPayment = async (req, res, next) => {
  try {
    const payment = await service.createPayment(
      req.productId,
      req.body,
      {
        idempotencyKey: req.idempotencyKey // Forwarded from middleware
      }
    );

    return res.status(201).json({
      success: true,
      data: payment
    });

  } catch (error) {
    console.error("Create Payment Error:", error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to create payment"
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