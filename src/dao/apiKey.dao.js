const prisma = require("../config/prismaClient");

class ApiKeyDAO {
  /**
   * Create a new API key
   * @param {Object} tx - Prisma transaction client (optional)
   * @param {Object} keyData - API key data
   * @returns {Promise<Object>} API Key
   */


  /**
 * Get all API keys with pagination & filtering (no - pagination)
 */

  async getAllApiKeys(tx, filters = {}) {
    const client = tx || prisma;

    const { productId, isActive } = filters;

    const where = {};

    if (productId) where.productId = productId;
    if (typeof isActive === "boolean") where.isActive = isActive;

    const keys = await client.apiKey.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
      },
    });

    return keys;
  }

  // Closed the getAllApiKeys method



  async createApiKey(tx, keyData) {
    const client = tx || prisma;

    return client.apiKey.create({
      data: {
        productId: keyData.productId,
        keyName: keyData.keyName,
        keyHash: keyData.keyHash,
        keyPrefix: keyData.keyPrefix,
        environment: keyData.environment,
        permissions: keyData.permissions,
        rateLimitPerMin: keyData.rateLimitPerMin,
        expiresAt: keyData.expiresAt,
        isActive: keyData.isActive !== undefined ? keyData.isActive : true
      },
      include: {
        product: true
      }
    });
  }

  /**
   * Get API key by ID
   * @param {Object} tx - Prisma transaction client (optional)
   * @param {string} keyId - API key ID
   * @returns {Promise<Object|null>} API Key
   */
  async getApiKeyById(tx, keyId) {
    const client = tx || prisma;

    return client.apiKey.findUnique({
      where: { id: keyId },
      include: {
        product: true
      }
    });
  }

  /**
   * Get API key by prefix
   * @param {Object} tx - Prisma transaction client (optional)
   * @param {string} keyPrefix - Key prefix
   * @param {boolean} activeOnly - Only return active keys
   * @returns {Promise<Object|null>} API Key
   */
  async getApiKeysByPrefix(tx, keyPrefix, activeOnly = true) {
    const client = tx || prisma;

    const where = { keyPrefix };
    if (activeOnly) {
      where.isActive = true;
    }

    return client.apiKey.findMany({
      where,
      include: {
        product: true
      }
    });
  }

  /**
   * Get all API keys for a product
   * @param {Object} tx - Prisma transaction client (optional)
   * @param {string} productId - Product ID
   * @returns {Promise<Array>} API Keys
   */
  async getApiKeysByProductId(tx, productId) {
    const client = tx || prisma;

    return client.apiKey.findMany({
      where: { productId },
      include: {
        product: true
      },
      orderBy: { createdAt: "desc" }
    });
  }

  /**
   * Update API key
   * @param {Object} tx - Prisma transaction client (optional)
   * @param {string} keyId - API key ID
   * @param {Object} data - Update data
   * @returns {Promise<Object>} Updated API key
   */
  async updateApiKey(tx, keyId, data) {
    const client = tx || prisma;

    return client.apiKey.update({
      where: { id: keyId },
      data,
      include: {
        product: true
      }
    });
  }

  /**
   * Update API key last used timestamp
   * @param {Object} tx - Prisma transaction client (optional)
   * @param {string} keyId - API key ID
   * @param {Date} lastUsedAt - Last used timestamp
   * @returns {Promise<Object>} Updated API key
   */
  async updateLastUsedAt(tx, keyId, lastUsedAt) {
    const client = tx || prisma;

    return client.apiKey.update({
      where: { id: keyId },
      data: { lastUsedAt }
    });
  }

  /**
   * Delete API key
   * @param {Object} tx - Prisma transaction client (optional)
   * @param {string} keyId - API key ID
   * @returns {Promise<Object>} Deletion result
   */
  async deleteApiKey(tx, keyId) {
    const client = tx || prisma;

    return client.apiKey.delete({
      where: { id: keyId }
    });
  }
}

module.exports = new ApiKeyDAO();
