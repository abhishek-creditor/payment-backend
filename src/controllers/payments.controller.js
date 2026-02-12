const service = require("../services/payments.service");

/**
 * Create a new payment
 * POST /api/payments
 */
exports.createPayment = async (req, res) => {
  try {
    // Use req.productId instead of req.tenantId (set by auth middleware)
    const payment = await service.createPayment(req.productId, req.body);
    
    res.status(201).json({
      success: true,
      data: payment
    });
  } catch (error) {
    console.error("Error creating payment:", error);
    res.status(500).json({ 
      error: error.message || "Failed to create payment" 
    });
  }
};

/**
 * Get all payments for the authenticated product
 * GET /api/payments
 */
exports.getPayments = async (req, res) => {
  try {
    const payments = await service.getPayments(req.productId, req.query);
    
    res.status(200).json({
      success: true,
      data: payments
    });
  } catch (error) {
    console.error("Error fetching payments:", error);
    res.status(500).json({ 
      error: error.message || "Failed to fetch payments" 
    });
  }
};

/**
 * Get a specific payment by ID
 * GET /api/payments/:id
 */
exports.getPaymentById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const payment = await service.getPaymentById(req.productId, id);
    
    if (!payment) {
      return res.status(404).json({ 
        error: "Payment not found" 
      });
    }
    
    res.status(200).json({
      success: true,
      data: payment
    });
  } catch (error) {
    console.error("Error fetching payment:", error);
    res.status(500).json({ 
      error: error.message || "Failed to fetch payment" 
    });
  }
};

/**
 * Refund a payment
 * POST /api/payments/:id/refund
 */
exports.refundPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, reason } = req.body;
    
    // Validate required fields
    if (!amount) {
      return res.status(400).json({ 
        error: "Refund amount is required" 
      });
    }
    
    const refund = await service.refundPayment(req.productId, id, {
      amount,
      reason
    });
    
    res.status(200).json({
      success: true,
      data: refund,
      message: "Refund processed successfully"
    });
  } catch (error) {
    console.error("Error processing refund:", error);
    res.status(500).json({ 
      error: error.message || "Failed to process refund" 
    });
  }
};