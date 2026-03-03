const prisma = require("../config/prismaClient");

exports.createOrder = (data) => {
  return prisma.order.create({ data });
};

exports.getOrders = (filters) => {
  return prisma.order.findMany({
    where: {
      ...(filters.productId && { productId: filters.productId }),
      ...(filters.planId && { planId: filters.planId }),
    },
    orderBy: { createdAt: "desc" },
  });
};

exports.getOrderById = (id) => {
  return prisma.order.findUnique({ where: { id } });
};

exports.updateOrder = (id, data) => {
  return prisma.order.update({
    where: { id },
    data,
  });
};

exports.deleteOrder = (id) => {
  return prisma.order.delete({ where: { id } });
};

exports.createPayment = (data) => {
  return prisma.payment.create({ data });
};

exports.getPayments = (filters) => {
  return prisma.payment.findMany({
    where: {
      ...(filters.status && { status: filters.status }),
    },
    orderBy: { createdAt: "desc" },
  });
};

exports.getPaymentById = (id) => {
  return prisma.payment.findUnique({ where: { id } });
};

exports.updatePayment = (id, data) => {
  return prisma.payment.update({
    where: { id },
    data,
  });
};

exports.deletePayment = (id) => {
  return prisma.payment.delete({ where: { id } });
};

exports.createRefund = (data) => {
  return prisma.refund.create({ data });
};

exports.getRefunds = () => {
  return prisma.refund.findMany({
    orderBy: { createdAt: "desc" },
  });
};

exports.getRefundById = (id) => {
  return prisma.refund.findUnique({ where: { id } });
};

exports.updateRefund = (id, data) => {
  return prisma.refund.update({
    where: { id },
    data,
  });
};

exports.deleteRefund = (id) => {
  return prisma.refund.delete({ where: { id } });
};