const express = require("express");
const router = express.Router();
// const authenticate = require("../middleware/auth");
const requireIdempotencyKey = require("../middleware/requireIdempotencyKey");
const requirePermissions = require("../middleware/requirePermissions");
const idempotency = require("../middleware/idempotency");
const controller = require("../controllers/payments.controller");
const { validateCreatePayment } = require("../middleware/validatePaymentRequest");
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
  validateCreatePayment,
  requireIdempotencyKey,
  idempotency,
  controller.createPayment
);

/**
 * @route   POST /api/payments/confirm
 * @desc    Confirm a subscription payment with a Tilled.js payment_method_id
 * @access  Requires API key with "charge" permission, but since it's called 
 *          from the frontend payment page, we allow it without strict API key 
 *          if the orderId matches an INITIATED order (or we can use a temporary token).
 *          For now, we will trust the API key if provided via the frontend proxy.
 */
router.post(
  "/confirm",
  requirePermissions(["charge"]),
  require("../middleware/validatePaymentRequest").validateConfirmPayment,
  controller.confirmPayment
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
 * @route   GET /api/payments/status
 * @desc    Get order status by orderId
 * @access  Requires API key with "read" permission
 */
router.get(
  "/status",
  requirePermissions(["read"]),
  controller.getOrderStatus
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
  requireIdempotencyKey,
  idempotency,
  controller.refundPayment // You'll need to add this controller method
);

module.exports = router;