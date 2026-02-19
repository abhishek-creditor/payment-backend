const bcrypt = require("bcryptjs");
const apiKeyDAO = require("../dao/apiKey.dao");
const rateLimitService = require("../services/rateLimit.service");

module.exports = async function authenticate(req, res, next) {
  try {
    const apiKey = req.header("x-api-key");

    if (!apiKey) {
      return res.status(401).json({ error: "Missing API key" });
    }

    // Extract prefix (e.g., "pk_live_lms_")
    const prefix = apiKey.substring(0, apiKey.lastIndexOf("_") + 1);

    // Find key by prefix
    const key = await apiKeyDAO.getApiKeyByPrefix(null, prefix, true);

    if (!key) {
      return res.status(403).json({ error: "Invalid API key" });
    }

    // Verify full key using bcrypt
    const isValid = await bcrypt.compare(apiKey, key.keyHash);

    if (!isValid) {
      return res.status(403).json({ error: "Invalid API key" });
    }

    // Check expiry
    if (key.expiresAt && new Date() > key.expiresAt) {
      return res.status(403).json({ error: "API key has expired" });
    }

    // Rate Limit Check via Service Layer
    const rateLimitResult = await rateLimitService.checkRateLimit(
      key.id,
      key.rateLimitPerMin
    );

    if (rateLimitResult.limited) {
      res.set({
        "Retry-After": rateLimitResult.retryAfter,
        "X-RateLimit-Limit": rateLimitResult.limit,
        "X-RateLimit-Remaining": rateLimitResult.remaining
      });

      return res.status(429).json({
        error: "Rate limit exceeded",
        retryAfter: rateLimitResult.retryAfter
      });
    }

    // Update lastUsedAt asynchronously
    apiKeyDAO.updateLastUsedAt(null, key.id, new Date())
      .catch(err => console.error("Failed to update lastUsedAt:", err));

    // Attach key info to request
    req.apiKey = key;
    req.productId = key.productId;
    req.product = key.product;
    req.permissions = key.permissions;

    next();

  } catch (error) {
    console.error("Authentication error:", error);
    return res.status(500).json({ error: "Authentication failed" });
  }
};
