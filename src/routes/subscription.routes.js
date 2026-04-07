const express = require("express");
const router = express.Router();
const requirePermissions = require("../middleware/requirePermissions");
const controller = require("../controllers/subscription.controller");

/**
 * @route   POST /api/subscriptions/:tilledSubscriptionId/cancel
 * @desc    Cancel an active subscription
 * @access  Requires API key with "charge" permission
 */
router.post(
    "/:tilledSubscriptionId/cancel",
    requirePermissions(["charge"]),
    controller.cancelSubscription
);

/**
 * @route   GET /api/subscriptions/:tilledSubscriptionId
 * @desc    Get subscription status
 * @access  Requires API key with "read" permission
 */
router.get(
    "/:tilledSubscriptionId",
    requirePermissions(["read"]),
    controller.getSubscription
);

module.exports = router;