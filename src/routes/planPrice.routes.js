// routes/planPrice.routes.js
const express = require("express");
const router = express.Router();
const planPriceController = require("../controllers/planPrice.controller");

// --- Static routes (must come BEFORE /:planId to avoid param collision) ---
// GET    /admin/plans/supported-currencies              → list all supported countries + currencies
router.get("/supported-currencies", planPriceController.getSupportedCurrencies);

// --- Plan-specific price CRUD ---
// POST   /admin/plans/:planId/prices                    → add a currency-price
// GET    /admin/plans/:planId/prices                    → list all prices for a plan
// PUT    /admin/plans/:planId/prices/:currency          → update a price
// DELETE /admin/plans/:planId/prices/:currency          → remove a price
router.post("/:planId/prices", planPriceController.createPrice);
router.get("/:planId/prices", planPriceController.listPrices);
router.put("/:planId/prices/:currency", planPriceController.updatePrice);
router.delete("/:planId/prices/:currency", planPriceController.deletePrice);

// --- Plan pricing tools ---
// GET    /admin/plans/:planId/pricing-matrix             → full pricing overview (configured + missing currencies)
// GET    /admin/plans/:planId/resolve-price?country=IN   → dry-run: what would a user from this country pay?
router.get("/:planId/pricing-matrix", planPriceController.getPricingMatrix);
router.get("/:planId/resolve-price", planPriceController.resolvePrice);

module.exports = router;
