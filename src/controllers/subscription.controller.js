const service = require("../services/subscription.service");

exports.cancelSubscription = async (req, res) => {
    try {
        const { tilledSubscriptionId } = req.params;
        const { tilledAccountId } = req.body;

        if (!tilledSubscriptionId) {
            return res.status(400).json({
                success: false,
                message: "tilledSubscriptionId is required"
            });
        }

        const result = await service.cancelSubscription(
            req.productId,
            tilledSubscriptionId,
            tilledAccountId || null
        );

        return res.status(200).json({
            success: true,
            data: result
        });

    } catch (error) {
        console.error("Cancel Subscription Error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Failed to cancel subscription"
        });
    }
};

exports.getSubscription = async (req, res) => {
    try {
        const { tilledSubscriptionId } = req.params;

        const subscription = await service.getSubscriptionStatus(
            req.productId,
            tilledSubscriptionId
        );

        return res.status(200).json({
            success: true,
            data: subscription
        });

    } catch (error) {
        console.error("Get Subscription Error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Failed to fetch subscription"
        });
    }
};