const prisma = require("../config/prismaClient");

class SubscriptionDAO {
    /**
     * Upsert a subscription based on Tilled webhook data
     * @param {Object} tx - Prisma transaction client (optional)
     * @param {Object} data - Subscription data
     * @returns {Promise<Object>} Subscription
     */
    async upsertSubscription(tx, data) {
        const client = tx || prisma;

        return client.subscription.upsert({
            where: {
                tilledSubscriptionId: data.tilledSubscriptionId
            },
            update: {
                status: data.status,
                currentPeriodStart: data.currentPeriodStart,
                currentPeriodEnd: data.currentPeriodEnd,
                cancelAtPeriodEnd: data.cancelAtPeriodEnd,
                cancelledAt: data.cancelledAt,
                metadata: data.metadata || undefined
            },
            create: {
                productId: data.productId,
                productUserId: data.productUserId,
                planId: data.planId,
                tilledSubscriptionId: data.tilledSubscriptionId,
                status: data.status,
                currentPeriodStart: data.currentPeriodStart,
                currentPeriodEnd: data.currentPeriodEnd,
                cancelAtPeriodEnd: data.cancelAtPeriodEnd,
                metadata: data.metadata
            }
        });
    }

    /**
     * Update subscription status
     * @param {Object} tx - Prisma transaction client (optional)
     * @param {string} tilledSubscriptionId - Tilled Subscription ID
     * @param {string} newStatus - New status for the subscription
     * @param {Object} extraUpdates - Any extra updates like currentPeriodStart, etc.
     * @returns {Promise<Object>} Updated Subscription
     */
    async updateSubscriptionByTilledId(tx, tilledSubscriptionId, newStatus, extraUpdates = {}) {
        const client = tx || prisma;

        return client.subscription.updateMany({
            where: { tilledSubscriptionId },
            data: {
                status: newStatus,
                ...extraUpdates
            }
        });
    }
}

module.exports = new SubscriptionDAO();
