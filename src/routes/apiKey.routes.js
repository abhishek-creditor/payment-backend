const express = require("express");
const router = express.Router();
const apiKeyController = require("../controllers/apiKey.controller");

// Note: These routes should be protected by admin authentication
// You might want to add an admin auth middleware here

/**
 * @route   POST /api/keys
 * @desc    Generate a new API key
 * @access  Admin
 * @body    { productId, keyName, environment?, permissions?, rateLimitPerMin?, expiresInDays? }
 */
router.post("/", apiKeyController.create);

// mari banai hui api key list karne ke liye route

router.get("/getAllkeys", apiKeyController.getAllKeys);


/**
 * @route   GET /api/keys?productId=xxx
 * @desc    List all API keys for a product
 * @access  Admin
 */
router.get("/", apiKeyController.list);

/**
 * @route   GET /api/keys/:id
 * @desc    Get details of a specific API key
 * @access  Admin
 */
router.get("/:id", apiKeyController.get);

/**
 * @route   PATCH /api/keys/:id
 * @desc    Update API key settings
 * @access  Admin
 * @body    { keyName?, permissions?, rateLimitPerMin?, expiresAt?, isActive? }
 */
router.patch("/:id", apiKeyController.update);

/**
 * @route   POST /api/keys/:id/regenerate
 * @desc    Regenerate an API key (creates new key with same settings)
 * @access  Admin
 */
router.post("/:id/regenerate", apiKeyController.regenerate);

/**
 * @route   POST /api/keys/:id/deactivate
 * @desc    Deactivate an API key (soft delete)
 * @access  Admin
 */
router.post("/:id/deactivate", apiKeyController.deactivate);

/**
 * @route   DELETE /api/keys/:id
 * @desc    Permanently delete an API key
 * @access  Admin
 */
router.delete("/:id", apiKeyController.delete);

/**
 * @route   GET /api/keys/:id/stats
 * @desc    Get usage statistics for an API key
 * @access  Admin
 * @query   days? (default: 7)
 */
router.get("/:id/stats", apiKeyController.getStats);

module.exports = router;