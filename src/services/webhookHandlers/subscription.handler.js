const subscriptionDAO = require("../../dao/subscription.dao");

/**
 * Safely parse a Tilled date value.
 * Tilled may return: a Unix timestamp (number), an ISO string, or undefined.
 * Returns a valid Date or the provided fallback.
 */
function parseTilledDate(value, fallback = new Date()) {
    if (!value && value !== 0) return fallback;
    // If it's a small number, treat as Unix timestamp (seconds) and convert to ms
    if (typeof value === "number" && value < 1e12) {
        return new Date(value * 1000);
    }
    const d = new Date(value);
    return isNaN(d.getTime()) ? fallback : d;
}

const tilledStatusMap = {
    active: "ACTIVE",
    pending: "ACTIVE",  // Maps Tilled "pending" to Prisma "ACTIVE"
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

    if (!productId || !productUserId || !planId) {
        console.warn(`[subscription.created] ⚠️ Missing metadata (productId=${productId}, productUserId=${productUserId}, planId=${planId}). Skipping DB upsert.`);
        return;
    }

    try {
        await subscriptionDAO.upsertSubscription(null, {
            productId,
            productUserId,
            planId,
            tilledSubscriptionId: subscription.id,
            status: mapStatus(subscription.status),
            currentPeriodStart: parseTilledDate(subscription.current_period_start),
            currentPeriodEnd: parseTilledDate(subscription.current_period_end, parseTilledDate(subscription.next_payment_at)),
            cancelAtPeriodEnd: subscription.cancel_at_period_end || false,
            metadata: subscription
        });
        console.log(`Subscription ${subscription.id} created/upserted successfully.`);
    } catch (upsertErr) {
        console.error(`[subscription.created] ❌ Upsert failed for ${subscription.id}: ${upsertErr.message}`);
        // Don't rethrow — the /confirm endpoint may have already created it (race condition)
    }

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
};

exports.handleSubscriptionUpdated = async (event) => {
    const subscription = event.data;

    try {
        await subscriptionDAO.updateSubscriptionByTilledId(null, subscription.id, mapStatus(subscription.status), {
            currentPeriodStart: parseTilledDate(subscription.current_period_start),
            currentPeriodEnd: parseTilledDate(subscription.current_period_end, parseTilledDate(subscription.next_payment_at)),
            cancelAtPeriodEnd: subscription.cancel_at_period_end || false,
        });
        console.log(`Subscription ${subscription.id} updated.`);
    } catch (updateErr) {
        console.error(`[subscription.updated] ❌ Update failed for ${subscription.id}: ${updateErr.message}`);
    }

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

    try {
        await subscriptionDAO.updateSubscriptionByTilledId(null, subscription.id, "CANCELLED", {
            cancelledAt: new Date(),
            cancelAtPeriodEnd: subscription.cancel_at_period_end || false,
        });
        console.log(`Subscription ${subscription.id} cancelled.`);
    } catch (cancelErr) {
        console.error(`[subscription.canceled] ❌ Update failed for ${subscription.id}: ${cancelErr.message}`);
    }

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
