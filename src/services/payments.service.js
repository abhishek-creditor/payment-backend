const prisma = require("../utils/prisma");

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
