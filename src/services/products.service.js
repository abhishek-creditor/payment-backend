const prisma = require("../config/prismaClient");

class ProductService {
  /**
   * Create a new product
   * @param {Object} params
   * @param {string} params.name
   * @param {string} params.code
   * @param {boolean} [params.isActive=true]
   */
  async createProduct({ name, code, isActive = true }) {
    const product = await prisma.product.create({
      data: {
        name,
        code,
        isActive,
      },
    });

    return product;
  }
}

module.exports = new ProductService();

