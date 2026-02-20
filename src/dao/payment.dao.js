const prisma = require("../utils/prisma");

class PaymentDAO {

  /**
   * Create a new payment
   */
  async createPayment(tx, paymentData) {
    const client = tx || prisma;

    if (!paymentData?.orderId || !paymentData?.method || !paymentData?.status) {
      throw new Error("Invalid payment data");
    }

    return client.payment.create({
      data: {
        orderId: paymentData.orderId,
        method: paymentData.method,
        status: paymentData.status,
        amount: paymentData.amount,
        ...(paymentData.tilledPaymentId && {
          tilledPaymentId: paymentData.tilledPaymentId
        }),
        ...(paymentData.rawRequest && {
          rawRequest: paymentData.rawRequest
        }),
        ...(paymentData.rawResponse && {
          rawResponse: paymentData.rawResponse
        })
      }
    });
  }

  /**
   * Get payment by ID
   */
  async getPaymentById(tx, paymentId, includeOptions = {}) {
    const client = tx || prisma;

    if (!paymentId) {
      throw new Error("Payment ID required");
    }

    return client.payment.findUnique({
      where: { id: paymentId },
      include: {
        order: includeOptions.order !== false,
        refunds: includeOptions.refunds !== false
      }
    });
  }

  /**
   * Get payment by Tilled payment ID
   */
  async getPaymentByTilledId(tx, tilledPaymentId) {
    const client = tx || prisma;

    if (!tilledPaymentId) return null;

    return client.payment.findUnique({
      where: { tilledPaymentId }
    });
  }

  /**
   * Get payments by order ID
   */
  async getPaymentsByOrderId(tx, orderId, includeOptions = {}) {
    const client = tx || prisma;

    if (!orderId) return [];

    return client.payment.findMany({
      where: { orderId },
      include: {
        refunds: includeOptions.refunds !== false
      }
    });
  }

  /**
   * Update payment
   */
  async updatePayment(tx, paymentId, data) {
    const client = tx || prisma;

    if (!paymentId) {
      throw new Error("Payment ID required for update");
    }

    return client.payment.update({
      where: { id: paymentId },
      data,
      include: {
        order: true,
        refunds: true
      }
    });
  }

  /**
   * Find payment by order ID and status
   */
  async findPaymentByOrderAndStatus(tx, orderId, status) {
    const client = tx || prisma;

    if (!orderId || !status) return null;

    return client.payment.findFirst({
      where: {
        orderId,
        status
      }
    });
  }
}

module.exports = new PaymentDAO();