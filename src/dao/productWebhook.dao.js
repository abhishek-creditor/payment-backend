// const prisma = require("../utils/prisma");
const prisma = require("../config/prismaClient");

async function create(data) {
  return prisma.productWebhookConfig.create({ data });
}

async function findAll() {
  return prisma.productWebhookConfig.findMany({
    orderBy: { createdAt: "desc" },
  });
}

async function findById(id) {
  return prisma.productWebhookConfig.findUnique({
    where: { id },
  });
}

async function findByProduct(productId) {
  return prisma.productWebhookConfig.findMany({
    where: { productId },
  });
}

async function update(id, data) {
  return prisma.productWebhookConfig.update({
    where: { id },
    data,
  });
}

async function remove(id) {
  return prisma.productWebhookConfig.delete({
    where: { id },
  });
}

module.exports = {
  create,
  findAll,
  findById,
  findByProduct,
  update,
  remove,
};