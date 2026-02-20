const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const productDAO = require("../dao/product.dao");
const apiKeyDAO = require("../dao/apiKey.dao");
const rateLimitTrackerDAO = require("../dao/rateLimitTracker.dao");
const apiRequestLogDAO = require("../dao/apiRequestLog.dao");

class ApiKeyService {

/**
 * Get all API keys (no pagination) (dashboard listing)
 */
async getAllApiKeys(queryParams) {
  const productId = queryParams.productId || undefined;
  const isActive =
    queryParams.isActive !== undefined
      ? queryParams.isActive === "true"
      : undefined;

  const keys = await apiKeyDAO.getAllApiKeys(null, {
    productId,
    isActive,
  });

  const formattedKeys = keys.map((key) => ({
    id: key.id,
    productId: key.productId,
    keyName: key.keyName,
    permissions: key.permissions,
    rateLimitPerMin: key.rateLimitPerMin,
    isActive: key.isActive,
    expiresAt: key.expiresAt,
    lastUsedAt: key.lastUsedAt,
    createdAt: key.createdAt,
    updatedAt: key.updatedAt,
    product: key.product,
  }));

  return {
    total: formattedKeys.length,
    data: formattedKeys,
  };
}

// closed the getAllApiKeys method


  /**
   * Generate a new API key
   * @param {Object} params - Key generation parameters
   * @returns {Object} - Generated key info with plain text key (only shown once!)
   */
  async generateApiKey({
    productId,
    keyName,
    environment = "production",
    permissions = ["read"],
    rateLimitPerMin = 100,
    expiresInDays = null,
  }) {
    // Validate product exists
    const product = await productDAO.getProductById(null, productId);

    if (!product) {
      throw new Error("Product not found");
    }

    // Generate random API key
    const randomBytes = crypto.randomBytes(32).toString("hex");
    const prefix = `pk_${environment.substring(0, 4)}_${product.code}_`;
    const apiKey = `${prefix}${randomBytes}`;

    // Hash the key for storage
    const keyHash = await bcrypt.hash(apiKey, 10);

    // Calculate expiration date
    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    // Save to database
    const savedKey = await apiKeyDAO.createApiKey(null, {
      productId,
      keyName,
      keyHash,
      keyPrefix: prefix,
      environment,
      permissions,
      rateLimitPerMin,
      expiresAt,
      isActive: true
    });

    // Return the plain text key (ONLY TIME IT'S VISIBLE!)
    return {
      id: savedKey.id,
      apiKey, // ⚠️ Store this securely - won't be shown again
      keyName: savedKey.keyName,
      keyPrefix: savedKey.keyPrefix,
      environment: savedKey.environment,
      permissions: savedKey.permissions,
      rateLimitPerMin: savedKey.rateLimitPerMin,
      expiresAt: savedKey.expiresAt,
      createdAt: savedKey.createdAt,
      product: {
        id: savedKey.product.id,
        name: savedKey.product.name,
        code: savedKey.product.code,
      },
    };
  }

  /**
   * List all API keys for a product (without showing the actual keys)
   */
  async listApiKeys(productId) {
    const keys = await apiKeyDAO.getApiKeysByProductId(null, productId);

    return keys.map((key) => ({
      id: key.id,
      keyName: key.keyName,
      keyPrefix: key.keyPrefix,
      environment: key.environment,
      permissions: key.permissions,
      rateLimitPerMin: key.rateLimitPerMin,
      isActive: key.isActive,
      expiresAt: key.expiresAt,
      lastUsedAt: key.lastUsedAt,
      createdAt: key.createdAt,
      product: {
        id: key.product.id,
        name: key.product.name,
        code: key.product.code,
      },
    }));
  }

  /**
   * Get details of a specific API key
   */
  async getApiKey(keyId) {
    const key = await apiKeyDAO.getApiKeyById(null, keyId);

    if (!key) {
      throw new Error("API key not found");
    }

    return {
      id: key.id,
      keyName: key.keyName,
      keyPrefix: key.keyPrefix,
      environment: key.environment,
      permissions: key.permissions,
      rateLimitPerMin: key.rateLimitPerMin,
      isActive: key.isActive,
      expiresAt: key.expiresAt,
      lastUsedAt: key.lastUsedAt,
      createdAt: key.createdAt,
      updatedAt: key.updatedAt,
      product: {
        id: key.product.id,
        name: key.product.name,
        code: key.product.code,
      },
    };
  }

  /**
   * Update API key settings (not the key itself)
   */
  async updateApiKey(keyId, updates) {
    const allowedUpdates = {
      keyName: updates.keyName,
      permissions: updates.permissions,
      rateLimitPerMin: updates.rateLimitPerMin,
      expiresAt: updates.expiresAt,
      isActive: updates.isActive,
    };

    // Remove undefined values
    Object.keys(allowedUpdates).forEach(
      (key) => allowedUpdates[key] === undefined && delete allowedUpdates[key]
    );

    const updatedKey = await apiKeyDAO.updateApiKey(null, keyId, allowedUpdates);

    return {
      id: updatedKey.id,
      keyName: updatedKey.keyName,
      keyPrefix: updatedKey.keyPrefix,
      environment: updatedKey.environment,
      permissions: updatedKey.permissions,
      rateLimitPerMin: updatedKey.rateLimitPerMin,
      isActive: updatedKey.isActive,
      expiresAt: updatedKey.expiresAt,
      lastUsedAt: updatedKey.lastUsedAt,
      createdAt: updatedKey.createdAt,
      updatedAt: updatedKey.updatedAt,
      product: {
        id: updatedKey.product.id,
        name: updatedKey.product.name,
        code: updatedKey.product.code,
      },
    };
  }

  /**
   * Regenerate an API key (creates new key, keeps same settings)
   */
  async regenerateApiKey(keyId) {
    const existingKey = await apiKeyDAO.getApiKeyById(null, keyId);

    if (!existingKey) {
      throw new Error("API key not found");
    }

    // Generate new random key
    const randomBytes = crypto.randomBytes(32).toString("hex");
    const apiKey = `${existingKey.keyPrefix}${randomBytes}`;

    // Hash the new key
    const keyHash = await bcrypt.hash(apiKey, 10);

    // Update the key
    const updatedKey = await apiKeyDAO.updateApiKey(null, keyId, {
      keyHash,
      lastUsedAt: null // Reset usage tracking
    });

    // Clear rate limit trackers for this key
    await rateLimitTrackerDAO.deleteTrackersByApiKeyId(null, keyId);

    return {
      id: updatedKey.id,
      apiKey, // ⚠️ New key - store this securely!
      keyName: updatedKey.keyName,
      keyPrefix: updatedKey.keyPrefix,
      environment: updatedKey.environment,
      permissions: updatedKey.permissions,
      rateLimitPerMin: updatedKey.rateLimitPerMin,
      expiresAt: updatedKey.expiresAt,
      createdAt: updatedKey.createdAt,
      product: {
        id: updatedKey.product.id,
        name: updatedKey.product.name,
        code: updatedKey.product.code,
      },
    };
  }

  /**
   * Deactivate an API key (soft delete)
   */
  async deactivateApiKey(keyId) {
    const deactivatedKey = await apiKeyDAO.updateApiKey(null, keyId, { isActive: false });

    return {
      id: deactivatedKey.id,
      keyName: deactivatedKey.keyName,
      isActive: deactivatedKey.isActive,
    };
  }

  /**
   * Delete an API key permanently
   */
  async deleteApiKey(keyId) {
    // This will cascade delete related records due to schema relations
    await apiKeyDAO.deleteApiKey(null, keyId);

    return { success: true, message: "API key deleted successfully" };
  }

  /**
   * Get usage statistics for an API key
   */
  async getApiKeyStats(keyId, days = 7) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const [requestCount, recentLogs] = await Promise.all([
      apiRequestLogDAO.countLogsByApiKeyId(null, keyId, startDate),
      apiRequestLogDAO.getLogsByApiKeyId(null, keyId, startDate, {
        take: 100,
        select: {
          statusCode: true,
          createdAt: true,
          endpoint: true
        }
      })
    ]);

    // Calculate success rate
    const successfulRequests = recentLogs.filter(
      (log) => log.statusCode >= 200 && log.statusCode < 300
    ).length;

    return {
      totalRequests: requestCount,
      successRate:
        recentLogs.length > 0
          ? ((successfulRequests / recentLogs.length) * 100).toFixed(2)
          : 0,
      period: `Last ${days} days`,
      recentRequests: recentLogs.slice(0, 10),
    };
  }

  /**
   * Clean up old rate limit trackers (run this periodically)
   */
  async cleanupOldRateLimits() {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const result = await rateLimitTrackerDAO.deleteOldTrackers(null, oneHourAgo);

    return {
      deleted: result.count,
      message: `Cleaned up ${result.count} old rate limit trackers`,
    };
  }
}

module.exports = new ApiKeyService();