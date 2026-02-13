const productService = require("../services/products.service");

class ProductsController {
  /**
   * POST /api/products
   * Create a new product
   */
  async create(req, res) {
    try {
      const { name, code, isActive } = req.body;

      if (!name || !code) {
        return res.status(400).json({
          error: "Missing required fields: name and code",
        });
      }

      const product = await productService.createProduct({
        name,
        code,
        isActive,
      });

      return res.status(201).json({
        success: true,
        data: product,
      });
    } catch (error) {
      console.error("Error creating product:", error);
      return res.status(500).json({
        error: error.message || "Failed to create product",
      });
    }
  }
}

module.exports = new ProductsController();

