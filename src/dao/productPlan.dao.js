// dao/productPlan.dao.js
const prisma = require("../utils/prisma");

const productPlanDao = {

  // Create
  async createPlan(data) {
    return await prisma.productPlan.create({
      data,
    });
  },

  // Get all with optional product name filter
  async getAllPlans(productName) {
    return await prisma.productPlan.findMany({
      where: productName
        ? {
            product: {
              code: {
                contains: productName,
                mode: "insensitive",
              },
            },
          }
        : {},
      include: {
        product: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  },

  // Get by ID
  async getPlanById(id) {
    return await prisma.productPlan.findUnique({
      where: { id },
      include: {
        product: true,
      },
    });
  },

  // Update
  async updatePlan(id, data) {
    return await prisma.productPlan.update({
      where: { id },
      data,
    });
  },

  // Delete
  async deletePlan(id) {
    return await prisma.productPlan.delete({
      where: { id },
    });
  },
};

module.exports = productPlanDao;