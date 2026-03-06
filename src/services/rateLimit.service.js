const rateLimitTrackerDAO = require("../dao/rateLimitTracker.dao");

class RateLimitService {
  async checkRateLimit(apiKeyId, rateLimitPerMin) {
    const now = new Date();

    const windowStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      now.getHours(),
      now.getMinutes(),
      0,
      0
    );

    try {
      const tracker = await rateLimitTrackerDAO.upsertTracker(
        null,
        apiKeyId,
        windowStart
      );

      const remaining = Math.max(
        rateLimitPerMin - tracker.requestCount,
        0
      );

      // secondsPassed means -> kitna time nikal gaya current window ka. 
      const secondsPassed = now.getSeconds();
      const retryAfter = 60 - secondsPassed;

      if (tracker.requestCount >= rateLimitPerMin) {
        return {
          limited: true,
          retryAfter,
          limit: rateLimitPerMin,
          remaining: 0
        };
      }

      return {
        limited: false,
        retryAfter: 0,
        limit: rateLimitPerMin,
        remaining
      };

    } catch (error) {
      console.error("Rate limit service error:", error);

      // Fail-closed 
      return {
        limited: true,
        retryAfter: 60,
        limit: rateLimitPerMin,
        remaining: 0
      };
    }
  }
}

module.exports = new RateLimitService();
