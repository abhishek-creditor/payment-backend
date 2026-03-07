const service = require("../services/subscriptions.service");

/**
 * CREATE SUBSCRIPTION
 * POST /api/subscriptions
 */
exports.createSubscription = async (req, res) => {
    try {
        const subscription = await service.createSubscription(
            req.productId,
            req.body
        );

        return res.status(201).json({
            success: true,
            data: subscription,
        });
    } catch (error) {
        console.error("Create Subscription Error:", error);

        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Failed to create subscription",
        });
    }
};
