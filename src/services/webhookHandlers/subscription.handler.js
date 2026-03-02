const subscriptionDAO = require("../../dao/subscription.dao");

exports.handleSubscriptionCreated = async (event) => {
    const subscription = event.data;
    const metadata = subscription.metadata || {};
    const { productId, productUserId, planId } = metadata;

    if (productId && productUserId && planId) {
        await subscriptionDAO.upsertSubscription(null, {
            productId,
            productUserId,
            planId,
            tilledSubscriptionId: subscription.id,
            status: subscription.status.toUpperCase(), // Assuming Tilled uses active/canceled
            currentPeriodStart: new Date(subscription.current_period_start * 1000),
            currentPeriodEnd: new Date(subscription.current_period_end * 1000),
            cancelAtPeriodEnd: subscription.cancel_at_period_end || false,
            metadata: subscription
        });
        console.log(`Subscription ${subscription.id} created successfully.`);
    }
};

exports.handleSubscriptionUpdated = async (event) => {
    const subscription = event.data;
    await subscriptionDAO.updateSubscriptionByTilledId(null, subscription.id, subscription.status.toUpperCase(), {
        currentPeriodStart: new Date(subscription.current_period_start * 1000),
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        cancelAtPeriodEnd: subscription.cancel_at_period_end || false,
    });
    console.log(`Subscription ${subscription.id} updated.`);
};

exports.handleSubscriptionCanceled = async (event) => {
    const subscription = event.data;
    await subscriptionDAO.updateSubscriptionByTilledId(null, subscription.id, "CANCELLED", {
        cancelledAt: new Date(),
        cancelAtPeriodEnd: subscription.cancel_at_period_end || false,
    });
    console.log(`Subscription ${subscription.id} cancelled.`);
};
