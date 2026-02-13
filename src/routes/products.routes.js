const express = require("express");
const router = express.Router();
const productsController = require("../controllers/products.controller");

// Note: These routes are intended for admin use.
// You may want to protect them with an admin auth middleware.

/**
 * @route   POST /api/products
 * @desc    Create a new product
 * @access  Admin
 * @body    { name, code, isActive? }
 */
router.post("/", productsController.create);

module.exports = router;

