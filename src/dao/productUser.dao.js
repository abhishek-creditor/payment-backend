const prisma = require("../utils/prisma");

class ProductUserDAO {
  /**
   * Create or update a product user
   * @param {Object} tx - Prisma transaction client (optional)
   * @param {string} productId - Product ID
   * @param {string} externalUserId - External user ID
   * @param {string} email - User email (optional)
   * @returns {Promise<Object>} ProductUser
   */
  async upsertProductUser(tx, productId, externalUserId, email) {
    const client = tx || prisma;
    
    return client.productUser.upsert({
      where: {
        productId_externalUserId: {
          productId,
          externalUserId
        }
      },
      update: {
        email: email || undefined
      },
      create: {
        productId,
        externalUserId,
        email
      }
    });
  }

  /**
   * Get product user by ID
   * @param {Object} tx - Prisma transaction client (optional)
   * @param {string} productUserId - Product User ID
   * @returns {Promise<Object|null>} ProductUser
   */
  async getProductUserById(tx, productUserId) {
    const client = tx || prisma;
    
    return client.productUser.findUnique({
      where: { id: productUserId }
    });
  }

  /**
   * Get product user by product and external user ID
   * @param {Object} tx - Prisma transaction client (optional)
   * @param {string} productId - Product ID
   * @param {string} externalUserId - External user ID
   * @returns {Promise<Object|null>} ProductUser
   */
  async getProductUserByExternalId(tx, productId, externalUserId) {
    const client = tx || prisma;
    
    return client.productUser.findUnique({
      where: {
        productId_externalUserId: {
          productId,
          externalUserId
        }
      }
    });
  }
}

module.exports = new ProductUserDAO();
