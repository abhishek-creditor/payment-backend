const auditLogDAO = require("../dao/auditLog.dao");

const auditLogger = (req, res, next) => {
  const startTime = Date.now();

  const originalSend = res.send;

  res.send = function (body) {
    const responseTime = Date.now() - startTime;

    const logData = {
      userId: req.user?.id || null,
      userName: req.user?.name || null,
      // status: res.statusCode >= 400 ? "FAILED" : "SUCCESS",
      status: res.statusCode >= 400 ? "CHALGAI" : "KHATAM",
      ipAddress: req.ip,
      httpMethod: req.method,
      path: req.originalUrl,
      metadata: {
        statusCode: res.statusCode,
        responseTimeMs: responseTime
      },
      errorMessage: res.statusCode >= 400 ? body : null
    };

    // Fire and forget (non-blocking)
    // auditLogDAO.createLog(logData);

    return originalSend.call(this, body);
  };

  next();
};

module.exports = auditLogger;