const prisma = require("../utils/prisma");

module.exports = async function errorLogger(err, req, res, next) {
  console.error("[GLOBAL ERROR]", err);

  try {
    await prisma.apiRequestLog.create({
      data: {
        apiKeyId: req.apiKey?.id || null,
        productId: req.productId || null,
        endpoint: req.originalUrl || req.url,
        method: req.method,
        statusCode: 500,
        ipAddress: req.ip || null,
        userAgent: req.headers["user-agent"] || null,
        requestBody: req.body || null,
        errorMessage: err.message
      }
    });
  } catch (e) {
    console.error("[ERROR LOGGING FAILED]", e.message);
  }

  res.status(500).json({
    error: "Internal Server Error"
  });
};