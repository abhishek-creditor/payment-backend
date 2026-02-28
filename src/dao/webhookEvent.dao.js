const prisma = require("../utils/prisma");

class WebhookEventDAO {
    /**
     * Insert a new webhook event log
     * @param {Object} tx - Prisma transaction client (optional)
     * @param {Object} data - Webhook event data: { eventType, tilledId, payload }
     * @returns {Promise<Object>} WebhookEvent
     */
    async createEvent(tx, data) {
        const client = tx || prisma;

        // We use upsert to avoid Unique Constraint violation if exact same webhook arrives twice.
        return client.webhookEvent.upsert({
            where: {
                eventType_tilledId: {
                    eventType: data.eventType,
                    tilledId: data.tilledId
                }
            },
            update: {
                // if already received, just update payload
                payload: data.payload
            },
            create: {
                eventType: data.eventType,
                tilledId: data.tilledId,
                payload: data.payload,
                processed: false
            }
        });
    }

    /**
     * Mark a webhook as successfully processed
     * @param {Object} tx - Prisma transaction client (optional)
     * @param {string} eventId - WebhookEvent database ID
     * @returns {Promise<Object>} WebhookEvent
     */
    async markAsProcessed(tx, eventId) {
        const client = tx || prisma;

        return client.webhookEvent.update({
            where: { id: eventId },
            data: {
                processed: true,
                processedAt: new Date()
            }
        });
    }
}

module.exports = new WebhookEventDAO();
