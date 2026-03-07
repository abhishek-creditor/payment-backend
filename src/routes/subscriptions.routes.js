const express = require("express");
const router = express.Router();
const requirePermissions = require("../middleware/requirePermissions");
const controller = require("../controllers/subscriptions.controller");
const { validateCreateSubscription } = require("../middleware/validateSubscriptionRequest");

// ============================================
// SUBSCRIPTION ROUTES
// All routes here already have authenticate middleware applied in app.js
// ============================================

/**
 * @route   POST /api/subscriptions
 * @desc    Create a new subscription for a user
 * @access  Requires API key with "charge" permission
 */
router.post(
    "/",
    requirePermissions(["charge"]),
    validateCreateSubscription,
    controller.createSubscription
);

module.exports = router;
