const prisma = require("../config/prismaClient");

class ApiRequestLogDAO {
  /**
   * Create a new API request log
   * @param {Object} tx - Prisma transaction client (optional)
   * @param {Object} logData - Log data
   * @returns {Promise<Object>} Request log
   */
  async createLog(tx, logData) {
    const client = tx || prisma;
    
    return client.apiRequestLog.create({
      data: {
        apiKeyId: logData.apiKeyId || null,
        productId: logData.productId || null,
        endpoint: logData.endpoint,
        method: logData.method,
        statusCode: logData.statusCode || null,
        ipAddress: logData.ipAddress || null,
        userAgent: logData.userAgent || null,
        requestBody: logData.requestBody || null,
        responseTimeMs: logData.responseTimeMs || null,
        errorMessage: logData.errorMessage || null
      }
    });
  }

  /**
   * Get request logs for an API key
   * @param {Object} tx - Prisma transaction client (optional)
   * @param {string} apiKeyId - API key ID
   * @param {Date} startDate - Start date
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Request logs
   */
  async getLogsByApiKeyId(tx, apiKeyId, startDate, options = {}) {
    const client = tx || prisma;
    
    const {
      take = 100,
      select = {
        statusCode: true,
        createdAt: true,
        endpoint: true
      }
    } = options;

    return client.apiRequestLog.findMany({
      where: {
        apiKeyId,
        createdAt: { gte: startDate }
      },
      select,
      orderBy: { createdAt: "desc" },
      take
    });
  }

  /**
   * Count request logs for an API key
   * @param {Object} tx - Prisma transaction client (optional)
   * @param {string} apiKeyId - API key ID
   * @param {Date} startDate - Start date
   * @returns {Promise<number>} Count
   */
  async countLogsByApiKeyId(tx, apiKeyId, startDate) {
    const client = tx || prisma;
    
    return client.apiRequestLog.count({
      where: {
        apiKeyId,
        createdAt: { gte: startDate }
      }
    });
  }

  /**
   * Get request logs with filters
   * @param {Object} tx - Prisma transaction client (optional)
   * @param {Object} filters - Filter options
   * @returns {Promise<Array>} Request logs
   */
  async getLogs(tx, filters = {}) {
    const client = tx || prisma;
    
    const where = {};
    
    if (filters.apiKeyId) where.apiKeyId = filters.apiKeyId;
    if (filters.productId) where.productId = filters.productId;
    if (filters.startDate) where.createdAt = { gte: filters.startDate };
    if (filters.endDate) {
      where.createdAt = where.createdAt || {};
      where.createdAt.lte = filters.endDate;
    }
    if (filters.statusCode) where.statusCode = filters.statusCode;

    return client.apiRequestLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: filters.limit || 100,
      skip: filters.skip || 0
    });
  }
}

module.exports = new ApiRequestLogDAO();
