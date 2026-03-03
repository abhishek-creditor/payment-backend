const prisma = require("../config/prismaClient");
const crudDao = require("../dao/CRUD.dao");

exports.createOrder = async (data) => {
  return crudDao.createOrder(data);
};

exports.getOrders = async (query) => {
  return crudDao.getOrders(query);
};

exports.getOrderById = async (id) => {
  return crudDao.getOrderById(id);
};

exports.updateOrder = async (id, data) => {
  return crudDao.updateOrder(id, data);
};

exports.deleteOrder = async (id) => {
  return crudDao.deleteOrder(id);
};
exports.createPayment = async (data) => {
  return crudDao.createPayment(data);
};

exports.getPayments = async (query) => {
  return crudDao.getPayments(query);
};

exports.getPaymentById = async (id) => {
  return crudDao.getPaymentById(id);
};

exports.updatePayment = async (id, data) => {
  return crudDao.updatePayment(id, data);
};

exports.deletePayment = async (id) => {
  return crudDao.deletePayment(id);
};
exports.createRefund = async (data) => {
  const { paymentId, amount, status, reason, tilledRefundId } = data;

  return await prisma.$transaction(async (tx) => {
    // 1️⃣ Get payment with order
    const payment = await tx.payment.findUnique({
      where: { id: paymentId },
      include: { order: true, refunds: true },
    });

    if (!payment) {
      throw new Error("Payment not found");
    }

    if (payment.status !== "SUCCEEDED") {
      throw new Error("Refund not allowed for this payment status");
    }

    // 2️⃣ Create refund
    const refund = await tx.refund.create({
      data: {
        paymentId,
        amount,
        status,
        reason,
        tilledRefundId,
      },
    });

    // 3️⃣ Calculate total refunded amount
    const totalRefunded =
      payment.refunds.reduce((sum, r) => sum + r.amount, 0) + amount;

    // 4️⃣ Determine new Payment status
    let newPaymentStatus;

    if (totalRefunded === payment.amount) {
      newPaymentStatus = "REFUNDED";
    } else if (totalRefunded < payment.amount) {
      newPaymentStatus = "PARTIALLY_REFUNDED";
    } else {
      throw new Error("Refund amount exceeds payment amount");
    }

    // 5️⃣ Update Payment status
    await tx.payment.update({
      where: { id: paymentId },
      data: { status: newPaymentStatus },
    });

    // 6️⃣ Determine Order refund status
    const orderPayments = await tx.payment.findMany({
      where: { orderId: payment.orderId },
      include: { refunds: true },
    });

    const allPaymentsFullyRefunded = orderPayments.every((p) => {
      const refundedAmount = p.refunds.reduce((s, r) => s + r.amount, 0);
      return refundedAmount === p.amount;
    });

    const anyPaymentPartiallyRefunded = orderPayments.some((p) => {
      const refundedAmount = p.refunds.reduce((s, r) => s + r.amount, 0);
      return refundedAmount > 0 && refundedAmount < p.amount;
    });

    let newOrderStatus = payment.order.status;

    if (allPaymentsFullyRefunded) {
      newOrderStatus = "REFUNDED";
    } else if (anyPaymentPartiallyRefunded) {
      newOrderStatus = "PARTIALLY_REFUNDED";
    }

    // 7️⃣ Update Order status
    await tx.order.update({
      where: { id: payment.orderId },
      data: { status: newOrderStatus },
    });

    return refund;
  });
};

exports.getRefunds = async () => {
  return crudDao.getRefunds();
};

exports.getRefundById = async (id) => {
  return crudDao.getRefundById(id);
};

exports.updateRefund = async (id, data) => {
  return crudDao.updateRefund(id, data);
};

exports.deleteRefund = async (id) => {
  return crudDao.deleteRefund(id);
};