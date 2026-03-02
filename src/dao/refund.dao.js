const prisma = require("../config/prismaClient");

class RefundDAO {
  /**
   * Create a new refund
   * @param {Object} tx - Prisma transaction client (optional)
   * @param {Object} refundData - Refund data
   * @returns {Promise<Object>} Refund
   */
  async createRefund(tx, refundData) {
    const client = tx || prisma;
    
    return client.refund.create({
      data: {
        paymentId: refundData.paymentId,
        tilledRefundId: refundData.tilledRefundId || null,
        amount: refundData.amount,
        status: refundData.status || "PENDING",
        reason: refundData.reason || null
      }
    });
  }

  /**
   * Get refund by ID
   * @param {Object} tx - Prisma transaction client (optional)
   * @param {string} refundId - Refund ID
   * @returns {Promise<Object|null>} Refund
   */
  async getRefundById(tx, refundId) {
    const client = tx || prisma;
    
    return client.refund.findUnique({
      where: { id: refundId },
      include: {
        payment: {
          include: {
            order: true
          }
        }
      }
    });
  }

  /**
   * Get refund by Tilled refund ID
   * @param {Object} tx - Prisma transaction client (optional)
   * @param {string} tilledRefundId - Tilled refund ID
   * @returns {Promise<Object|null>} Refund
   */
  async getRefundByTilledId(tx, tilledRefundId) {
    const client = tx || prisma;
    
    return client.refund.findUnique({
      where: { tilledRefundId }
    });
  }

  /**
   * Get refunds by payment ID
   * @param {Object} tx - Prisma transaction client (optional)
   * @param {string} paymentId - Payment ID
   * @returns {Promise<Array>} Refunds
   */
  async getRefundsByPaymentId(tx, paymentId) {
    const client = tx || prisma;
    
    return client.refund.findMany({
      where: { paymentId },
      orderBy: { createdAt: 'desc' }
    });
  }

  /**
   * Update refund status
   * @param {Object} tx - Prisma transaction client (optional)
   * @param {string} refundId - Refund ID
   * @param {string} status - New status
   * @returns {Promise<Object>} Updated refund
   */
  async updateRefundStatus(tx, refundId, status) {
    const client = tx || prisma;
    
    return client.refund.update({
      where: { id: refundId },
      data: { status },
      include: {
        payment: {
          include: {
            order: true
          }
        }
      }
    });
  }

  /**
   * Update refund
   * @param {Object} tx - Prisma transaction client (optional)
   * @param {string} refundId - Refund ID
   * @param {Object} data - Update data
   * @returns {Promise<Object>} Updated refund
   */
  async updateRefund(tx, refundId, data) {
    const client = tx || prisma;
    
    return client.refund.update({
      where: { id: refundId },
      data
    });
  }
}

module.exports = new RefundDAO();
