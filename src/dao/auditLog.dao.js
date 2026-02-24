// My File New Created 
const prisma = require("../utils/prisma");

class AuditLogDAO {
  async createLog(data) {
    try {
      return await prisma.auditLog.create({
        data: {
          userId: data.userId || null,
          userName: data.userName || null,
          serviceName: "payment-service",
          eventType: "WEBHOOK_RECEIVED", // default for now
          status: data.status,
          ipAddress: data.ipAddress || null,
          httpMethod: data.httpMethod,
          path: data.path,
          metadata: data.metadata || null,
          errorMessage: data.errorMessage || null
        }
      });
    } catch (error) {
      console.error("Audit Log Insert Error:", error.message);
    }
  }
}

module.exports = new AuditLogDAO();