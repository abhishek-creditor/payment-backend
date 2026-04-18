// dao/productPlanPrice.dao.js
const prisma = require("../config/prismaClient");

const productPlanPriceDAO = {
  /**
   * Find a single price row for a plan + currency combination.
   * @param {object|null} tx - Prisma transaction client (or null for direct query)
   * @param {string} planId
   * @param {string} currency - ISO 4217 (e.g. "INR", "USD")
   * @returns {object|null}
   */
  async findPrice(tx, planId, currency) {
    const client = tx || prisma;
    return await client.productPlanPrice.findUnique({
      where: {
        planId_currency: { planId, currency: currency.toUpperCase() },
      },
    });
  },

  /**
   * List all currency-prices for a plan.
   * @param {object|null} tx
   * @param {string} planId
   * @returns {object[]}
   */
  async listPricesForPlan(tx, planId) {
    const client = tx || prisma;
    return await client.productPlanPrice.findMany({
      where: { planId },
      orderBy: { currency: "asc" },
    });
  },

  /**
   * Create a new price row. Throws P2002 if planId+currency already exists.
   * @param {object|null} tx
   * @param {object} data - { planId, currency, amount, gateway? }
   * @returns {object}
   */
  async createPrice(tx, data) {
    const client = tx || prisma;
    return await client.productPlanPrice.create({
      data: {
        planId: data.planId,
        currency: data.currency.toUpperCase(),
        amount: data.amount,
        gateway: data.gateway || null,
      },
    });
  },

  /**
   * Update an existing price row.
   * @param {object|null} tx
   * @param {string} planId
   * @param {string} currency
   * @param {object} data - { amount?, gateway? }
   * @returns {object}
   */
  async updatePrice(tx, planId, currency, data) {
    const client = tx || prisma;
    return await client.productPlanPrice.update({
      where: {
        planId_currency: { planId, currency: currency.toUpperCase() },
      },
      data,
    });
  },

  /**
   * Delete a price row for a plan + currency.
   * @param {object|null} tx
   * @param {string} planId
   * @param {string} currency
   * @returns {object}
   */
  async deletePrice(tx, planId, currency) {
    const client = tx || prisma;
    return await client.productPlanPrice.delete({
      where: {
        planId_currency: { planId, currency: currency.toUpperCase() },
      },
    });
  },
};

module.exports = productPlanPriceDAO;
