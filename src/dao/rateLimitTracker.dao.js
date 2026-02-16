const prisma = require("../utils/prisma");

class RateLimitTrackerDAO {
  /**
   * Upsert rate limit tracker (increment or create)
   * @param {Object} tx - Prisma transaction client (optional)
   * @param {string} apiKeyId - API key ID
   * @param {Date} windowStart - Window start time
   * @returns {Promise<Object>} Rate limit tracker
   */
  async upsertTracker(tx, apiKeyId, windowStart) {
    const client = tx || prisma;
    
    return client.rateLimitTracker.upsert({
      where: {
        apiKeyId_windowStart: {
          apiKeyId,
          windowStart
        }
      },
      update: {
        requestCount: {
          increment: 1
        }
      },
      create: {
        apiKeyId,
        windowStart,
        requestCount: 1
      }
    });
  }

  /**
   * Get rate limit tracker
   * @param {Object} tx - Prisma transaction client (optional)
   * @param {string} apiKeyId - API key ID
   * @param {Date} windowStart - Window start time
   * @returns {Promise<Object|null>} Rate limit tracker
   */
  async getTracker(tx, apiKeyId, windowStart) {
    const client = tx || prisma;
    
    return client.rateLimitTracker.findUnique({
      where: {
        apiKeyId_windowStart: {
          apiKeyId,
          windowStart
        }
      }
    });
  }

  /**
   * Delete old rate limit trackers
   * @param {Object} tx - Prisma transaction client (optional)
   * @param {Date} beforeDate - Delete trackers before this date
   * @returns {Promise<Object>} Deletion result
   */
  async deleteOldTrackers(tx, beforeDate) {
    const client = tx || prisma;
    
    return client.rateLimitTracker.deleteMany({
      where: {
        windowStart: { lt: beforeDate }
      }
    });
  }

  /**
   * Delete rate limit trackers for an API key
   * @param {Object} tx - Prisma transaction client (optional)
   * @param {string} apiKeyId - API key ID
   * @returns {Promise<Object>} Deletion result
   */
  async deleteTrackersByApiKeyId(tx, apiKeyId) {
    const client = tx || prisma;
    
    return client.rateLimitTracker.deleteMany({
      where: { apiKeyId }
    });
  }
}

module.exports = new RateLimitTrackerDAO();
