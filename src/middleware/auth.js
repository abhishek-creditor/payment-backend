const bcrypt = require("bcryptjs");
const apiKeyDAO = require("../dao/apiKey.dao");
const rateLimitService = require("../services/rateLimit.service");
const prisma = require("../config/prismaClient");

module.exports = async function authenticate(req, res, next) {
  try {
    const apiKey = req.header("x-api-key");

    if (!apiKey) {
      return res.status(401).json({ error: "Missing API key" });
    }

    // Extract prefix (e.g., "pk_live_lms_")
    const prefix = apiKey.substring(0, apiKey.lastIndexOf("_") + 1);

    // Find keys by prefix
    const keys = await apiKeyDAO.getApiKeysByPrefix(null, prefix, true);

    if (!keys || keys.length === 0) {
      return res.status(403).json({ error: "Invalid API key" });
    }

    // Verify full key using bcrypt
    let key = null;
    for (const k of keys) {
      const isValid = await bcrypt.compare(apiKey, k.keyHash);
      if (isValid) {
        key = k;
        break;
      }
    }

    if (!key) {
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

    // --- Delegate Mode ---
    // If this key has the "delegate" permission and the request body contains
    // a productCode, resolve the actual target product from that code.
    // This allows a shared checkout frontend to authenticate with its own key
    // while making payments on behalf of a specific product (e.g., "lms").
    let resolvedProductId = key.productId;
    let resolvedProduct = key.product;

    if (key.permissions.includes("delegate") && req.body?.productCode) {
      const targetProduct = await prisma.product.findUnique({
        where: { code: req.body.productCode }
      });

      if (!targetProduct) {
        return res.status(400).json({
          error: `Invalid productCode: "${req.body.productCode}" does not match any known product`
        });
      }

      if (!targetProduct.isActive) {
        return res.status(400).json({
          error: `Product "${req.body.productCode}" is not active`
        });
      }

      resolvedProductId = targetProduct.id;
      resolvedProduct = targetProduct;

      console.log(`[Auth] Delegate mode: key=${key.keyPrefix}* acting for product=${targetProduct.code} (${targetProduct.id})`);
    }

    // Attach key info to request
    req.apiKey = key;
    req.productId = resolvedProductId;
    req.product = resolvedProduct;
    req.permissions = key.permissions;

    next();

  } catch (error) {
    console.error("Authentication error:", error);
    return res.status(500).json({ error: "Authentication failed" });
  }
};
