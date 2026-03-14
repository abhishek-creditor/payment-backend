const subscriptionDAO = require("../../dao/subscription.dao");

const tilledStatusMap = {
    active: "ACTIVE",
    pending: "PENDING",
    paused: "INACTIVE",
    canceled: "CANCELLED",
    past_due: "PAST_DUE",
    trialing: "TRIAL",
};

function mapStatus(tilledStatus) {
    if (!tilledStatus) return "ACTIVE";
    return tilledStatusMap[tilledStatus.toLowerCase()] || "ACTIVE";
}

exports.handleSubscriptionCreated = async (event) => {
    const subscription = event.data;
    const metadata = subscription.metadata || {};
    const { productId, productUserId, planId, orderId } = metadata; // Added orderId

    if (productId && productUserId && planId) {
        await subscriptionDAO.upsertSubscription(null, {
            productId,
            productUserId,
            planId,
            tilledSubscriptionId: subscription.id,
            status: mapStatus(subscription.status),
            currentPeriodStart: new Date(subscription.current_period_start * 1000),
            currentPeriodEnd: new Date(subscription.current_period_end * 1000),
            cancelAtPeriodEnd: subscription.cancel_at_period_end || false,
            metadata: subscription
        });
        console.log(`Subscription ${subscription.id} created successfully.`);

        // Dispatch webhook to product backend asynchronously
        if (orderId) {
            try {
                console.log(`Dispatching 'subscription.created' webhook for order ${orderId}...`);
                const webhookDispatcher = require("../webhookDispatcher.service");
                await webhookDispatcher.dispatch(orderId, "subscription.created");
                console.log(`Webhook 'subscription.created' dispatched successfully.`);
            } catch (err) {
                console.error(`Failed to dispatch 'subscription.created' webhook:`, err.message);
            }
        }
    }
};

exports.handleSubscriptionUpdated = async (event) => {
    const subscription = event.data;
    await subscriptionDAO.updateSubscriptionByTilledId(null, subscription.id, mapStatus(subscription.status), {
        currentPeriodStart: new Date(subscription.current_period_start * 1000),
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        cancelAtPeriodEnd: subscription.cancel_at_period_end || false,
    });
    console.log(`Subscription ${subscription.id} updated.`);

    const orderId = subscription.metadata?.orderId;
    if (orderId) {
        try {
            console.log(`Dispatching 'subscription.updated' webhook for order ${orderId}...`);
            const webhookDispatcher = require("../webhookDispatcher.service");
            await webhookDispatcher.dispatch(orderId, "subscription.updated");
            console.log(`Webhook 'subscription.updated' dispatched successfully.`);
        } catch (err) {
            console.error(`Failed to dispatch 'subscription.updated' webhook:`, err.message);
        }
    }
};

exports.handleSubscriptionCanceled = async (event) => {
    const subscription = event.data;
    await subscriptionDAO.updateSubscriptionByTilledId(null, subscription.id, "CANCELLED", {
        cancelledAt: new Date(),
        cancelAtPeriodEnd: subscription.cancel_at_period_end || false,
    });
    console.log(`Subscription ${subscription.id} cancelled.`);

    const orderId = subscription.metadata?.orderId;
    if (orderId) {
        try {
            console.log(`Dispatching 'subscription.canceled' webhook for order ${orderId}...`);
            const webhookDispatcher = require("../webhookDispatcher.service");
            await webhookDispatcher.dispatch(orderId, "subscription.canceled");
            console.log(`Webhook 'subscription.canceled' dispatched successfully.`);
        } catch (err) {
            console.error(`Failed to dispatch 'subscription.canceled' webhook:`, err.message);
        }
    }
};
