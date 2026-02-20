const express = require("express");
const router = express.Router();
// const authenticate = require("../middleware/auth");
const requirePermissions = require("../middleware/requirePermissions");
const idempotency = require("../middleware/idempotency");
const controller = require("../controllers/payments.controller");

// ============================================
// PAYMENT ROUTES
// All routes here already have authenticate middleware applied in app.js
// So we only need to add permission checks and other middleware
// ============================================

/**
 * @route   POST /api/payments
 * @desc    Create a new payment/charge
 * @access  Requires API key with "charge" permission
 */
router.post(
  "/",
  requirePermissions(["charge"]),
  idempotency, // middleware to handle idempotency based on Idempotency-Key header
  controller.createPayment
);

/**
 * @route   GET /api/payments
 * @desc    Get all payments/orders
 * @access  Requires API key with "read" permission
 */
router.get(
  "/",
  requirePermissions(["read"]),
  controller.getPayments // You'll need to add this controller method
);

/**
 * @route   GET /api/payments/:id
 * @desc    Get a specific payment by ID
 * @access  Requires API key with "read" permission
 */
router.get(
  "/:id",
  requirePermissions(["read"]),
  controller.getPaymentById // You'll need to add this controller method
);

/**
 * @route   POST /api/payments/:id/refund
 * @desc    Refund a payment
 * @access  Requires API key with "refund" permission
 */ 
router.post(
  "/:id/refund",
  requirePermissions(["refund"]),
  idempotency,
  controller.refundPayment // You'll need to add this controller method
);

module.exports = router;