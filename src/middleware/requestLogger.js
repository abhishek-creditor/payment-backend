const prisma = require("../utils/prisma");

module.exports = function requestLogger(req, res, next) {
  const startTime = Date.now();

  const originalSend = res.send.bind(res);

  res.send = async function (body) {
    const responseTime = Date.now() - startTime;

    try {
      await prisma.apiRequestLog.create({
        data: {
          apiKeyId: req.apiKey?.id || null,
          productId: req.productId || null,
          endpoint: req.originalUrl || req.url,
          method: req.method,
          statusCode: res.statusCode,
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
          requestBody: req.body || null,
          responseTimeMs: responseTime,
          errorMessage: res.statusCode >= 400 ? body?.error || null : null
        }
      });
    } catch (err) {
      console.error("[REQUEST LOG ERROR]", err.message);
    }

    return originalSend(body);
  };

  next();
};