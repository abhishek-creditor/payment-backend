const express = require("express");
const router = express.Router();
const webhookController = require("../controllers/webhook.controller");

/**
 * @route   POST /api/webhooks/tilled
 * @desc    Receive webhooks from Tilled
 * @access  Public (Signature verification handled in controller)
 */
router.post(
    "/tilled",
    webhookController.webhook
);

module.exports = router;
