// src/utils/currency.js
// Currency normalisation utilities — smallest currency unit ↔ display amount.
// All amounts in the system are stored in the smallest currency unit (cents, paise, etc.).
// This module provides safe conversion and validation.

/**
 * Multiplier to convert 1 major unit → minor units for each currency.
 * Most currencies use 100 (e.g. $1.00 = 100 cents).
 * Zero-decimal currencies like JPY use 1.
 * Three-decimal currencies like KWD use 1000.
 */
const CURRENCY_MINOR_UNIT_MULTIPLIERS = {
  // Zero-decimal currencies (1 unit = 1 minor unit)
  BIF: 1,   // Burundian Franc
  CLP: 1,   // Chilean Peso
  DJF: 1,   // Djiboutian Franc
  GNF: 1,   // Guinean Franc
  JPY: 1,   // Japanese Yen
  KMF: 1,   // Comorian Franc
  KRW: 1,   // South Korean Won
  MGA: 1,   // Malagasy Ariary (technically 5 subdivisions, but treated as 0-decimal)
  PYG: 1,   // Paraguayan Guarani
  RWF: 1,   // Rwandan Franc
  UGX: 1,   // Ugandan Shilling
  VND: 1,   // Vietnamese Dong
  VUV: 1,   // Vanuatu Vatu
  XAF: 1,   // Central African CFA Franc
  XOF: 1,   // West African CFA Franc
  XPF: 1,   // CFP Franc

  // Three-decimal currencies (1 unit = 1000 minor units)
  BHD: 1000, // Bahraini Dinar
  IQD: 1000, // Iraqi Dinar
  JOD: 1000, // Jordanian Dinar
  KWD: 1000, // Kuwaiti Dinar
  LYD: 1000, // Libyan Dinar
  OMR: 1000, // Omani Rial
  TND: 1000, // Tunisian Dinar

  // Standard two-decimal currencies (1 unit = 100 minor units)
  USD: 100,
  EUR: 100,
  GBP: 100,
  INR: 100,
  AUD: 100,
  CAD: 100,
  CHF: 100,
  CNY: 100,
  HKD: 100,
  NZD: 100,
  SGD: 100,
  SEK: 100,
  NOK: 100,
  DKK: 100,
  PLN: 100,
  CZK: 100,
  HUF: 100,
  RON: 100,
  BGN: 100,
  HRK: 100,
  TRY: 100,
  ZAR: 100,
  BRL: 100,
  MXN: 100,
  ARS: 100,
  COP: 100,
  PEN: 100,
  PHP: 100,
  THB: 100,
  MYR: 100,
  IDR: 100,
  AED: 100,
  SAR: 100,
  QAR: 100,
  EGP: 100,
  NGN: 100,
  KES: 100,
  GHS: 100,
  TWD: 100,
  PKR: 100,
  BDT: 100,
  LKR: 100,
  NPR: 100,
};

// Default to 100 (two-decimal) for unknown currencies — safe for most ISO 4217 codes
const DEFAULT_MULTIPLIER = 100;

/**
 * Get the minor-unit multiplier for a currency.
 * @param {string} currency - ISO 4217 currency code (e.g. "USD", "JPY")
 * @returns {number} The multiplier (e.g. 100 for USD, 1 for JPY, 1000 for KWD)
 */
function getMultiplier(currency) {
  if (!currency) throw new Error("currency is required");
  return CURRENCY_MINOR_UNIT_MULTIPLIERS[currency.toUpperCase()] || DEFAULT_MULTIPLIER;
}

/**
 * Convert a display amount (e.g. 49.99) to the smallest currency unit (e.g. 4999).
 * Uses Math.round to handle floating-point imprecision safely.
 *
 * @param {number} displayAmount - Amount in major currency units (e.g. 49.99 USD)
 * @param {string} currency - ISO 4217 currency code
 * @returns {number} Amount in smallest currency unit (integer)
 *
 * @example
 *   toMinorUnit(49.99, 'USD')  → 4999
 *   toMinorUnit(1500, 'JPY')   → 1500  (JPY is zero-decimal)
 *   toMinorUnit(29.990, 'KWD') → 29990 (KWD is three-decimal)
 */
function toMinorUnit(displayAmount, currency) {
  if (typeof displayAmount !== "number" || isNaN(displayAmount)) {
    throw new Error("displayAmount must be a number");
  }
  const multiplier = getMultiplier(currency);
  return Math.round(displayAmount * multiplier);
}

/**
 * Convert a minor-unit amount (e.g. 4999) to display amount (e.g. 49.99).
 *
 * @param {number} minorAmount - Amount in smallest currency unit (e.g. 4999 cents)
 * @param {string} currency - ISO 4217 currency code
 * @returns {number} Amount in major currency units (e.g. 49.99)
 *
 * @example
 *   fromMinorUnit(4999, 'USD')  → 49.99
 *   fromMinorUnit(1500, 'JPY')  → 1500
 *   fromMinorUnit(29990, 'KWD') → 29.99
 */
function fromMinorUnit(minorAmount, currency) {
  if (typeof minorAmount !== "number" || isNaN(minorAmount)) {
    throw new Error("minorAmount must be a number");
  }
  const multiplier = getMultiplier(currency);
  return minorAmount / multiplier;
}

/**
 * Format a minor-unit amount as a human-readable string with the correct decimal places.
 *
 * @param {number} minorAmount - Amount in smallest currency unit
 * @param {string} currency - ISO 4217 currency code
 * @returns {string} Formatted string (e.g. "49.99", "1500", "29.990")
 *
 * @example
 *   formatAmount(4999, 'USD')  → "49.99"
 *   formatAmount(1500, 'JPY')  → "1500"
 *   formatAmount(29990, 'KWD') → "29.990"
 */
function formatAmount(minorAmount, currency) {
  const multiplier = getMultiplier(currency);
  const decimalPlaces = multiplier === 1 ? 0 : multiplier === 1000 ? 3 : 2;
  return (minorAmount / multiplier).toFixed(decimalPlaces);
}

/**
 * Check whether a currency code is known (has a defined multiplier).
 * Unknown currencies fall back to 2-decimal treatment.
 *
 * @param {string} currency - ISO 4217 currency code
 * @returns {boolean}
 */
function isKnownCurrency(currency) {
  if (!currency) return false;
  return currency.toUpperCase() in CURRENCY_MINOR_UNIT_MULTIPLIERS;
}

/**
 * Validate that a currency code is a plausible ISO 4217 code.
 * Does NOT check against an exhaustive list — just format validation.
 *
 * @param {string} currency - Currency code to validate
 * @returns {boolean} True if 3-letter uppercase alpha string
 */
function isValidCurrencyFormat(currency) {
  if (!currency || typeof currency !== "string") return false;
  return /^[A-Z]{3}$/.test(currency.toUpperCase());
}

module.exports = {
  CURRENCY_MINOR_UNIT_MULTIPLIERS,
  getMultiplier,
  toMinorUnit,
  fromMinorUnit,
  formatAmount,
  isKnownCurrency,
  isValidCurrencyFormat,
};
