// src/config/countryCurrency.js
// Static mapping of ISO 3166-1 alpha-2 country codes to ISO 4217 currency codes.
// Amounts are set manually per market in ProductPlanPrice — this is NOT currency conversion.

const COUNTRY_CURRENCY_MAP = {
  // North America
  US: 'USD',
  CA: 'CAD',

  // India
  IN: 'INR',

  // United Kingdom
  GB: 'GBP',

  // Eurozone
  DE: 'EUR',
  FR: 'EUR',
  IT: 'EUR',
  ES: 'EUR',
  NL: 'EUR',
  BE: 'EUR',
  AT: 'EUR',
  IE: 'EUR',
  PT: 'EUR',

  // Australia
  AU: 'AUD',
};

const DEFAULT_CURRENCY = 'USD';

/**
 * Resolve a country code to its payment currency.
 * Falls back to DEFAULT_CURRENCY if the country is unknown or not provided.
 *
 * @param {string|null|undefined} countryCode - ISO 3166-1 alpha-2 (e.g. "IN", "US")
 * @returns {string} ISO 4217 currency code (e.g. "INR", "USD")
 */
function resolveCurrency(countryCode) {
  if (!countryCode) return DEFAULT_CURRENCY;
  return COUNTRY_CURRENCY_MAP[countryCode.toUpperCase()] || DEFAULT_CURRENCY;
}

module.exports = { resolveCurrency, COUNTRY_CURRENCY_MAP, DEFAULT_CURRENCY };
