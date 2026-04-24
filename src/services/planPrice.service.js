// services/planPrice.service.js
// Business logic for multi-currency plan pricing

const productPlanPriceDAO = require("../dao/productPlanPrice.dao");
const { resolveCurrency, COUNTRY_CURRENCY_MAP } = require("../config/countryCurrency");
const { formatAmount, isValidCurrencyFormat } = require("../utils/currency");
const prisma = require("../config/prismaClient");

/**
 * Resolve the correct price for a plan given a country code.
 * Returns { amount, currency, gateway } or throws if not available.
 *
 * @param {string} planId
 * @param {string} countryCode - ISO 3166-1 alpha-2 (e.g. "IN", "US")
 * @returns {Promise<{amount: number, currency: string, gateway: string|null}>}
 */
async function resolvePlanPrice(planId, countryCode) {
  const currency = resolveCurrency(countryCode);
  const planPrice = await productPlanPriceDAO.findPrice(null, planId, currency);

  if (!planPrice) {
    const plan = await prisma.productPlan.findUnique({
      where: { id: planId },
      select: { name: true },
    });
    const planName = plan?.name || planId;
    const error = new Error(
      `Plan "${planName}" is not available in ${currency} (country: ${countryCode})`
    );
    error.statusCode = 400;
    throw error;
  }

  return {
    amount: planPrice.amount,
    currency: planPrice.currency,
    gateway: planPrice.gateway || null,
  };
}

/**
 * Resolve the correct price for a plan given a currency code directly.
 * Bypasses the country→currency map — for callers who already know the currency.
 *
 * @param {string} planId
 * @param {string} currencyCode - ISO 4217 (e.g. "INR", "USD")
 * @returns {Promise<{amount: number, currency: string, gateway: string|null}>}
 */
async function resolvePlanPriceByCurrency(planId, currencyCode) {
  if (!currencyCode || !isValidCurrencyFormat(currencyCode)) {
    const error = new Error("currency must be a valid 3-letter ISO 4217 code");
    error.statusCode = 400;
    throw error;
  }

  const currency = currencyCode.toUpperCase();
  const planPrice = await productPlanPriceDAO.findPrice(null, planId, currency);

  if (!planPrice) {
    const plan = await prisma.productPlan.findUnique({
      where: { id: planId },
      select: { name: true },
    });
    const planName = plan?.name || planId;
    const error = new Error(
      `Plan "${planName}" does not have a price configured for ${currency}`
    );
    error.statusCode = 400;
    throw error;
  }

  return {
    amount: planPrice.amount,
    currency: planPrice.currency,
    gateway: planPrice.gateway || null,
  };
}

/**
 * List all supported countries with their mapped currencies.
 * Returns the static map from countryCurrency.js.
 */
function getSupportedCountries() {
  const countries = Object.entries(COUNTRY_CURRENCY_MAP).map(([code, currency]) => ({
    countryCode: code,
    currency,
  }));

  // Group by currency for a cleaner response
  const byCurrency = {};
  for (const { countryCode, currency } of countries) {
    if (!byCurrency[currency]) {
      byCurrency[currency] = [];
    }
    byCurrency[currency].push(countryCode);
  }

  return {
    countries,
    byCurrency,
    totalCountries: countries.length,
    supportedCurrencies: Object.keys(byCurrency),
  };
}

/**
 * Get a pricing matrix for a plan — shows all currencies and their amounts.
 * Useful for admin dashboards and product integrations.
 * Uses the currency utility for correct display formatting (handles JPY, KWD, etc.).
 *
 * @param {string} planId
 * @returns {Promise<object>}
 */
async function getPlanPricingMatrix(planId) {
  const plan = await prisma.productPlan.findUnique({
    where: { id: planId },
    select: { id: true, name: true, code: true, price: true, currency: true },
  });

  if (!plan) {
    const error = new Error("Plan not found");
    error.statusCode = 404;
    throw error;
  }

  const prices = await productPlanPriceDAO.listPricesForPlan(null, planId);

  // Build a map of which currencies are configured vs which are supported
  const configuredCurrencies = prices.map((p) => p.currency);
  const { supportedCurrencies } = getSupportedCountries();
  const missingCurrencies = supportedCurrencies.filter(
    (c) => !configuredCurrencies.includes(c)
  );

  return {
    plan: {
      id: plan.id,
      name: plan.name,
      code: plan.code,
      legacyPrice: plan.price,
      legacyCurrency: plan.currency,
    },
    prices: prices.map((p) => ({
      currency: p.currency,
      amount: p.amount,
      displayAmount: formatAmount(p.amount, p.currency),
      gateway: p.gateway || null,
    })),
    configuredCurrencies,
    missingCurrencies,
    isFullyConfigured: missingCurrencies.length === 0,
  };
}

module.exports = {
  resolvePlanPrice,
  resolvePlanPriceByCurrency,
  getSupportedCountries,
  getPlanPricingMatrix,
};
