const subscriptionDAO = require("../dao/subscription.dao");
const orderDAO = require("../dao/order.dao");
const TilledService = require("./tilled.service");
const prisma = require("../config/prismaClient");

exports.cancelSubscription = async (productId, tilledSubscriptionId, tilledAccountId) => {

    // 1. Find the subscription and verify it belongs to this product
    const subscription = await prisma.subscription.findFirst({
        where: {
            tilledSubscriptionId: tilledSubscriptionId,
            productId,
            status: { notIn: ["CANCELLED", "INACTIVE"] }
        },
        include: {
            plan: true,
            productUser: true,
        }
    });

    if (!subscription) {
        const error = new Error("Subscription not found or already cancelled");
        error.statusCode = 404;
        throw error;
    }

    if (!subscription.tilledSubscriptionId) {
        const error = new Error("No Tilled subscription ID found for this subscription");
        error.statusCode = 400;
        throw error;
    }

    // 2. Call Tilled to cancel
    const tilledResponse = await TilledService.cancelSubscription(
        subscription.tilledSubscriptionId,
        tilledAccountId
    );

    if (tilledResponse.statusCode >= 400) {
        const error = new Error(
            `Tilled cancellation failed: ${JSON.stringify(tilledResponse.data)}`
        );
        error.statusCode = tilledResponse.statusCode;
        throw error;
    }

    // 3. Update DB
    await subscriptionDAO.updateSubscriptionByTilledId(
        null,
        subscription.tilledSubscriptionId,
        "CANCELLED",
        { cancelledAt: new Date() }
    );

    // 4. Update related order status
    const order = await prisma.order.findFirst({
        where: {
            subscriptionId: subscription.id,
            productId,
        }
    });

    if (order) {
        await orderDAO.updateOrder(null, order.id, { status: "CANCELLED" });
    }

    return {
        subscriptionId: subscription.id,
        tilledSubscriptionId: subscription.tilledSubscriptionId,
        status: "CANCELLED",
        cancelledAt: new Date(),
    };
};

exports.getSubscriptionStatus = async (productId, tilledSubscriptionId) => {
    const subscription = await prisma.subscription.findFirst({
        where: { tilledSubscriptionId: tilledSubscriptionId, productId },
        include: { plan: true }
    });

    if (!subscription) {
        const error = new Error("Subscription not found");
        error.statusCode = 404;
        throw error;
    }

    return subscription;
};