const bcrypt = require("bcryptjs");
const prisma = require("../utils/prisma");

module.exports = async function authenticate(req, res, next) {
  try {
    const apiKey = req.header("x-api-key");
    
    if (!apiKey) {
      return res.status(401).json({ error: "Missing API key" });
    }

    // Extract prefix (e.g., "pk_live_lms_")
    const prefix = apiKey.substring(0, apiKey.lastIndexOf("_") + 1);

    // Find key by prefix first (faster lookup)
    const key = await prisma.apiKey.findFirst({
      where: {
        keyPrefix: prefix,
        isActive: true,
      },
      include: {
        product: true,
      },
    });

    if (!key) {
      return res.status(403).json({ error: "Invalid API key" });
    }

    // Verify the full key using bcrypt
    const isValid = await bcrypt.compare(apiKey, key.keyHash);
    
    if (!isValid) {
      return res.status(403).json({ error: "Invalid API key" });
    }

    // Check if key has expired
    if (key.expiresAt && new Date() > key.expiresAt) {
      return res.status(403).json({ error: "API key has expired" });
    }

    // Check rate limit
    const isRateLimited = await checkRateLimit(key.id, key.rateLimitPerMin);
    
    if (isRateLimited) {
      return res.status(429).json({ 
        error: "Rate limit exceeded",
        retryAfter: 60 
      });
    }

    // Update last used timestamp (async, don't wait)
    prisma.apiKey.update({
      where: { id: key.id },
      data: { lastUsedAt: new Date() },
    }).catch(err => console.error("Failed to update lastUsedAt:", err));

    // Attach to request object
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

async function checkRateLimit(apiKeyId, rateLimitPerMin) {
  const now = new Date();
  const windowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 
                                now.getHours(), now.getMinutes(), 0, 0);

  try {
    // Use upsert to atomically increment or create the counter
    const tracker = await prisma.rateLimitTracker.upsert({
      where: {
        apiKeyId_windowStart: {
          apiKeyId,
          windowStart,
        },
      },
      update: {
        requestCount: {
          increment: 1,
        },
      },
      create: {
        apiKeyId,
        windowStart,
        requestCount: 1,
      },
    });

    // Check if limit exceeded
    return tracker.requestCount > rateLimitPerMin;
  } catch (error) {
    console.error("Rate limit check failed:", error);
    // Fail open - don't block request if rate limiting fails
    return false;
  }
}