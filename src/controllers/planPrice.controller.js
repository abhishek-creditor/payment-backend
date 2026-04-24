// controllers/planPrice.controller.js
const productPlanPriceDAO = require("../dao/productPlanPrice.dao");
const planPriceService = require("../services/planPrice.service");
const prisma = require("../config/prismaClient");
const { formatAmount } = require("../utils/currency");

/**
 * POST /admin/plans/:planId/prices
 * Add a currency-price to a plan.
 * Body: { currency, amount, gateway? }
 */
exports.createPrice = async (req, res) => {
  try {
    const { planId } = req.params;
    const { currency, amount, gateway } = req.body;

    if (!currency || typeof currency !== "string" || currency.trim().length < 2) {
      return res.status(400).json({ error: "currency is required (ISO 4217, e.g. 'INR')" });
    }
    if (amount === undefined || amount === null || typeof amount !== "number" || amount <= 0) {
      return res.status(400).json({ error: "amount must be a positive integer (smallest currency unit)" });
    }

    // Verify plan exists
    const plan = await prisma.productPlan.findUnique({ where: { id: planId } });
    if (!plan) {
      return res.status(404).json({ error: "Plan not found" });
    }

    const price = await productPlanPriceDAO.createPrice(null, {
      planId,
      currency,
      amount,
      gateway: gateway || null,
    });

    return res.status(201).json({
      success: true,
      data: price,
    });
  } catch (error) {
    // Prisma P2002 = unique constraint violation (planId + currency already exists)
    if (error.code === "P2002") {
      return res.status(409).json({
        error: `A price for currency "${req.body.currency?.toUpperCase()}" already exists on this plan. Use PUT to update.`,
      });
    }
    console.error("Error creating plan price:", error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * GET /admin/plans/:planId/prices
 * List all currency-prices for a plan.
 */
exports.listPrices = async (req, res) => {
  try {
    const { planId } = req.params;

    // Verify plan exists
    const plan = await prisma.productPlan.findUnique({ where: { id: planId } });
    if (!plan) {
      return res.status(404).json({ error: "Plan not found" });
    }

    const prices = await productPlanPriceDAO.listPricesForPlan(null, planId);

    return res.status(200).json({
      success: true,
      data: prices,
      count: prices.length,
    });
  } catch (error) {
    console.error("Error listing plan prices:", error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * PUT /admin/plans/:planId/prices/:currency
 * Update an existing currency-price for a plan.
 * Body: { amount?, gateway? }
 */
exports.updatePrice = async (req, res) => {
  try {
    const { planId, currency } = req.params;
    const { amount, gateway } = req.body;

    const updateData = {};
    if (amount !== undefined) {
      if (typeof amount !== "number" || amount <= 0) {
        return res.status(400).json({ error: "amount must be a positive integer" });
      }
      updateData.amount = amount;
    }
    if (gateway !== undefined) {
      updateData.gateway = gateway; // null is valid (clears override)
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: "Nothing to update. Provide amount or gateway." });
    }

    const price = await productPlanPriceDAO.updatePrice(null, planId, currency, updateData);

    return res.status(200).json({
      success: true,
      data: price,
    });
  } catch (error) {
    if (error.code === "P2025") {
      return res.status(404).json({ error: "Price not found for this plan and currency" });
    }
    console.error("Error updating plan price:", error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * DELETE /admin/plans/:planId/prices/:currency
 * Remove a currency-price from a plan.
 */
exports.deletePrice = async (req, res) => {
  try {
    const { planId, currency } = req.params;

    await productPlanPriceDAO.deletePrice(null, planId, currency);

    return res.status(200).json({
      success: true,
      message: `Price for ${currency.toUpperCase()} removed from plan`,
    });
  } catch (error) {
    if (error.code === "P2025") {
      return res.status(404).json({ error: "Price not found for this plan and currency" });
    }
    console.error("Error deleting plan price:", error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * GET /admin/plans/supported-currencies
 * List all supported countries and their mapped currencies.
 */
exports.getSupportedCurrencies = async (req, res) => {
  try {
    const result = planPriceService.getSupportedCountries();
    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Error fetching supported currencies:", error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * GET /admin/plans/:planId/pricing-matrix
 * Get the full pricing matrix for a plan — shows configured and missing currencies.
 */
exports.getPricingMatrix = async (req, res) => {
  try {
    const { planId } = req.params;
    const matrix = await planPriceService.getPlanPricingMatrix(planId);
    return res.status(200).json({
      success: true,
      data: matrix,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ error: error.message });
  }
};

/**
 * GET /admin/plans/:planId/resolve-price?country=IN
 * GET /admin/plans/:planId/resolve-price?currency=INR
 * Dry-run: resolve what price would apply.
 * Accepts either `country` (2-letter ISO 3166-1) or `currency` (3-letter ISO 4217).
 * If both are provided, `currency` takes priority.
 */
exports.resolvePrice = async (req, res) => {
  try {
    const { planId } = req.params;
    const { country, currency } = req.query;

    let result;
    let resolvedVia;

    if (currency) {
      if (currency.length !== 3) {
        return res.status(400).json({
          error: "currency must be a 3-letter ISO 4217 code (e.g. USD, INR)",
        });
      }
      result = await planPriceService.resolvePlanPriceByCurrency(planId, currency);
      resolvedVia = "currency";
    } else if (country) {
      if (country.length !== 2) {
        return res.status(400).json({
          error: "country must be a 2-letter ISO 3166-1 alpha-2 code (e.g. US, IN)",
        });
      }
      result = await planPriceService.resolvePlanPrice(planId, country);
      resolvedVia = "country";
    } else {
      return res.status(400).json({
        error: "Provide either 'country' (2-letter) or 'currency' (3-letter) query param",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        ...(country && { country: country.toUpperCase() }),
        ...result,
        displayAmount: formatAmount(result.amount, result.currency),
        resolvedVia,
      },
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ error: error.message });
  }
};
