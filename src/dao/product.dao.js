const prisma = require("../config/prismaClient");

class ProductDAO {
  /**
   * Get product by ID
   * @param {Object} tx - Prisma transaction client (optional)
   * @param {string} productId - Product ID
   * @returns {Promise<Object|null>} Product
   */
  async getProductById(tx, productId) {
    const client = tx || prisma;
    
    return client.product.findUnique({
      where: { id: productId }
    });
  }

  /**
   * Get product by code
   * @param {Object} tx - Prisma transaction client (optional)
   * @param {string} code - Product code
   * @returns {Promise<Object|null>} Product
   */
  async getProductByCode(tx, code) {
    const client = tx || prisma;
    
    return client.product.findUnique({
      where: { code }
    });
  }

  /**
   * Get all active products
   * @param {Object} tx - Prisma transaction client (optional)
   * @returns {Promise<Array>} Products
   */
  async getActiveProducts(tx) {
    const client = tx || prisma;
    
    return client.product.findMany({
      where: { isActive: true }
    });
  }
}

module.exports = new ProductDAO();
