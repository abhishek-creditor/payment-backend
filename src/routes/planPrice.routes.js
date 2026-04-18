// routes/planPrice.routes.js
const express = require("express");
const router = express.Router();
const planPriceController = require("../controllers/planPrice.controller");

// POST   /admin/plans/:planId/prices              → add a currency-price
// GET    /admin/plans/:planId/prices              → list all prices for a plan
// PUT    /admin/plans/:planId/prices/:currency    → update a price
// DELETE /admin/plans/:planId/prices/:currency    → remove a price

router.post("/:planId/prices", planPriceController.createPrice);
router.get("/:planId/prices", planPriceController.listPrices);
router.put("/:planId/prices/:currency", planPriceController.updatePrice);
router.delete("/:planId/prices/:currency", planPriceController.deletePrice);

module.exports = router;
