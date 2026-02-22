const prisma = require("../utils/prisma");

class AuditService {
  async log(data = {}) {
    try {
      const {
        userId = null,
        userName = null,
        paymentStatus = null,
        serviceName = "PAYMENT_SERVICE",
        eventType,
        status = "SUCCESS",
        productId = null,
        apiKeyId = null,
        orderId = null,
        paymentId = null,
        refundId = null,
        subscriptionId = null,
        ipAddress = null,
        httpMethod = null,
        path = null,
        requestId = null,
        metadata = null,
        errorMessage = null
      } = data;

      if (!eventType) {
        console.warn("[AUDIT] Missing eventType");
        return;
      }

      await prisma.auditLog.create({
        data: {
          userId,
          userName,
          paymentStatus,
          serviceName,
          eventType,
          status,
          productId,
          apiKeyId,
          orderId,
          paymentId,
          refundId,
          subscriptionId,
          ipAddress,
          httpMethod,
          path,
          requestId,
          metadata,
          errorMessage
        }
      });

    } catch (error) {
      // Audit should NEVER break main flow
      console.error("[AUDIT ERROR]", error.message);
    }
  }
}

module.exports = new AuditService();