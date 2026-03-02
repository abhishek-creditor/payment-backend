const prisma = require("../config/prismaClient");

class PaymentDAO {
  /**
   * Create a new payment
   * @param {Object} tx - Prisma transaction client (optional)
   * @param {Object} paymentData - Payment data
   * @returns {Promise<Object>} Payment
   */
  async createPayment(tx, paymentData) {
    const client = tx || prisma;
    
    return client.payment.create({
      data: {
        orderId: paymentData.orderId,
        method: paymentData.method,
        status: paymentData.status,
        amount: paymentData.amount,
        tilledPaymentId: paymentData.tilledPaymentId || null,
        rawRequest: paymentData.rawRequest || null,
        rawResponse: paymentData.rawResponse || null
      }
    });
  }

  /**
   * Get payment by ID
   * @param {Object} tx - Prisma transaction client (optional)
   * @param {string} paymentId - Payment ID
   * @param {Object} includeOptions - What to include
   * @returns {Promise<Object|null>} Payment
   */
  async getPaymentById(tx, paymentId, includeOptions = {}) {
    const client = tx || prisma;
    
    const include = {
      order: includeOptions.order !== false,
      refunds: includeOptions.refunds !== false
    };

    return client.payment.findUnique({
      where: { id: paymentId },
      include
    });
  }

  /**
   * Get payment by Tilled payment ID
   * @param {Object} tx - Prisma transaction client (optional)
   * @param {string} tilledPaymentId - Tilled payment ID
   * @returns {Promise<Object|null>} Payment
   */
  async getPaymentByTilledId(tx, tilledPaymentId) {
    const client = tx || prisma;
    
    return client.payment.findUnique({
      where: { tilledPaymentId }
    });
  }

  /**
   * Get payments by order ID
   * @param {Object} tx - Prisma transaction client (optional)
   * @param {string} orderId - Order ID
   * @param {Object} includeOptions - What to include
   * @returns {Promise<Array>} Payments
   */
  async getPaymentsByOrderId(tx, orderId, includeOptions = {}) {
    const client = tx || prisma;
    
    const include = {
      refunds: includeOptions.refunds !== false
    };

    return client.payment.findMany({
      where: { orderId },
      include
    });
  }

  /**
   * Update payment
   * @param {Object} tx - Prisma transaction client (optional)
   * @param {string} paymentId - Payment ID
   * @param {Object} data - Update data
   * @returns {Promise<Object>} Updated payment
   */
  async updatePayment(tx, paymentId, data) {
    const client = tx || prisma;
    
    const include = {
      order: true,
      refunds: true
    };

    return client.payment.update({
      where: { id: paymentId },
      data,
      include
    });
  }

  /**
   * Find payment by order ID and status
   * @param {Object} tx - Prisma transaction client (optional)
   * @param {string} orderId - Order ID
   * @param {string} status - Payment status
   * @returns {Promise<Object|null>} Payment
   */
  async findPaymentByOrderAndStatus(tx, orderId, status) {
    const client = tx || prisma;
    
    return client.payment.findFirst({
      where: {
        orderId,
        status
      }
    });
  }
}

module.exports = new PaymentDAO();
