const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

exports.createPayment = async (tenantId, data) => {
  return prisma.$transaction(async (tx) => {
    return tx.payment.create({
      data: {
        tenantId,
        amount: data.amount,
        currency: data.currency,
        status: "created"
      }
    });
  });
};
