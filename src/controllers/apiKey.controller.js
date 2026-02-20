const apiKeyService = require("../services/apiKey.service");

class ApiKeyController {

  /**
 * GET /api/api-keys
 * Dashboard listing of API keys
 */
async getAllKeys(req, res) {
  try {
    const result = await apiKeyService.getAllApiKeys(req.query);

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("Error fetching API keys:", error);
    return res.status(500).json({
      error: "Failed to fetch API keys",
    });
  }
}
// closed the getAllKeys method. 


  /**
   * POST /api/keys
   * Generate a new API key
   */
  async create(req, res) {
    try {
      const {
        productId,
        keyName,
        environment,
        permissions,
        rateLimitPerMin,
        expiresInDays,
      } = req.body;

      // Validate required fields
      if (!productId || !keyName) {
        return res.status(400).json({
          error: "Missing required fields: productId and keyName",
        });
      }

      const result = await apiKeyService.generateApiKey({
        productId,
        keyName,
        environment,
        permissions,
        rateLimitPerMin,
        expiresInDays,
      });

      return res.status(201).json({
        success: true,
        data: result,
        warning: "⚠️ Save this API key securely. It won't be shown again!",
      });
    } catch (error) {
      console.error("Error creating API key:", error);
      return res.status(500).json({
        error: error.message || "Failed to create API key",
      });
    }
  }

  /**
   * GET /api/keys?productId=xxx
   * List all API keys for a product
   */
  async list(req, res) {
    try {
      const { productId } = req.query;

      if (!productId) {
        return res.status(400).json({
          error: "Missing required query parameter: productId",
        });
      }

      const keys = await apiKeyService.listApiKeys(productId);

      return res.status(200).json({
        success: true,
        data: keys,
      });
    } catch (error) {
      console.error("Error listing API keys:", error);
      return res.status(500).json({
        error: error.message || "Failed to list API keys",
      });
    }
  }

  /**
   * GET /api/keys/:id
   * Get details of a specific API key
   */
  async get(req, res) {
    try {
      const { id } = req.params;

      const key = await apiKeyService.getApiKey(id);

      return res.status(200).json({
        success: true,
        data: key,
      });
    } catch (error) {
      console.error("Error getting API key:", error);
      return res.status(error.message === "API key not found" ? 404 : 500).json({
        error: error.message || "Failed to get API key",
      });
    }
  }

  /**
   * PATCH /api/keys/:id
   * Update API key settings
   */
  async update(req, res) {
    try {
      const { id } = req.params;
      const updates = req.body;

      const updatedKey = await apiKeyService.updateApiKey(id, updates);

      return res.status(200).json({
        success: true,
        data: updatedKey,
      });
    } catch (error) {
      console.error("Error updating API key:", error);
      return res.status(500).json({
        error: error.message || "Failed to update API key",
      });
    }
  }

  /**
   * POST /api/keys/:id/regenerate
   * Regenerate an API key
   */
  async regenerate(req, res) {
    try {
      const { id } = req.params;

      const result = await apiKeyService.regenerateApiKey(id);

      return res.status(200).json({
        success: true,
        data: result,
        warning: "⚠️ Save this new API key securely. It won't be shown again!",
      });
    } catch (error) {
      console.error("Error regenerating API key:", error);
      return res.status(500).json({
        error: error.message || "Failed to regenerate API key",
      });
    }
  }

  /**
   * POST /api/keys/:id/deactivate
   * Deactivate an API key
   */
  async deactivate(req, res) {
    try {
      const { id } = req.params;

      const result = await apiKeyService.deactivateApiKey(id);

      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error("Error deactivating API key:", error);
      return res.status(500).json({
        error: error.message || "Failed to deactivate API key",
      });
    }
  }

  /**
   * DELETE /api/keys/:id
   * Permanently delete an API key
   */
  async delete(req, res) {
    try {
      const { id } = req.params;

      const result = await apiKeyService.deleteApiKey(id);

      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error("Error deleting API key:", error);
      return res.status(500).json({
        error: error.message || "Failed to delete API key",
      });
    }
  }

  /**
   * GET /api/keys/:id/stats
   * Get usage statistics for an API key
   */
  async getStats(req, res) {
    try {
      const { id } = req.params;
      const { days } = req.query;

      const stats = await apiKeyService.getApiKeyStats(
        id,
        days ? parseInt(days) : 7
      );

      return res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (error) {
      console.error("Error getting API key stats:", error);
      return res.status(500).json({
        error: error.message || "Failed to get API key statistics",
      });
    }
  }
}

module.exports = new ApiKeyController();