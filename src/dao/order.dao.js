const prisma = require("../config/prismaClient");

class OrderDAO {
  /**
   * Create a new order with items
   * @param {Object} tx - Prisma transaction client (optional) 
   * @param {Object} orderData - Order data
   * @returns {Promise<Object>} Order
   */
  async createOrder(tx, orderData) {
    const client = tx || prisma;

    try {
      const order = await client.order.create({
        data: {
          product: {         //used connect to structure the code in a way prisma is accepting
            connect: { id: orderData.productId },
          },
          productUser: {
            connect: { id: orderData.productUserId },
          },
          plan: {
            connect: { id: orderData.planId },
          },
          referenceId: orderData.referenceId,
          amount: orderData.amount,
          currency: orderData.currency,
          status: orderData.status || "CREATED",
          orderType: orderData.orderType || "ONE_TIME",
          metadata: orderData.metadata || null,
          items: {
            create: (orderData.items || []).map((item) => ({
              name: item.name,
              sku: item.sku || null,
              quantity: item.quantity || 1,
              price: item.price,
            })),
          },
        },
        include: {
          items: true,
          productUser: {
            select: {
              id: true,
              externalUserId: true,
              email: true,
            },
          },
          payments: true,
        },
      });

      order.__duplicate = false;
      return order;
    } catch (error) {
      // Handle unique constraint safely
      if (error.code === "P2002") {

        // Duplicate detected based on unique constraint (e.g., referenceId + productId)
        console.warn("[IDEMPOTENCY] Duplicate detected", {
          productId: orderData.productId,
          referenceId: orderData.referenceId,
        });

        const existingOrder = await client.order.findFirst({
          where: {
            productId: orderData.productId,
            referenceId: orderData.referenceId,
          },
          include: {
            items: true,
            payments: true,
            productUser: {
              select: {
                id: true,
                externalUserId: true,
                email: true,
              },
            },
          },
        });

        if (existingOrder) {
          existingOrder.__duplicate = true;
          return existingOrder;
        }
      }

      throw error;
    }
  }

  /**
   * Get order by ID
   * @param {Object} tx - Prisma transaction client (optional)
   * @param {string} orderId - Order ID
   * @param {Object} includeOptions - What to include
   * @returns {Promise<Object|null>} Order
   */
  async getOrderById(tx, orderId, includeOptions = {}) {
    const client = tx || prisma;

    const include = {
      items: includeOptions.items !== false,
      payments:
        includeOptions.payments !== false
          ? {
            include: {
              refunds: includeOptions.refunds !== false,
            },
          }
          : false,
      productUser:
        includeOptions.productUser !== false
          ? {
            select: {
              id: true,
              externalUserId: true,
              email: true,
              tilledCustomerId: true,
            },
          }
          : false,
      plan: includeOptions.plan === true,
    };

    return client.order.findUnique({
      where: { id: orderId },
      include,
    });
  }

  /**
   * Get order by ID and product ID
   * @param {Object} tx - Prisma transaction client (optional)
   * @param {string} orderId - Order ID
   * @param {string} productId - Product ID
   * @param {Object} includeOptions - What to include
   * @returns {Promise<Object|null>} Order
   */
  async getOrderByIdAndProduct(tx, orderId, productId, includeOptions = {}) {
    const client = tx || prisma;

    const include = {
      items: includeOptions.items !== false,
      payments:
        includeOptions.payments !== false
          ? {
            include: {
              refunds: includeOptions.refunds !== false,
            },
          }
          : false,
      productUser:
        includeOptions.productUser !== false
          ? {
            select: {
              id: true,
              externalUserId: true,
              email: true,
              tilledCustomerId: true,
            },
          }
          : false,
      plan: includeOptions.plan === true,
    };

    return client.order.findFirst({
      where: {
        id: orderId,
        productId,
      },
      include,
    });
  }

  /**
   * Get order by idempotency key
   * @param {Object} tx - Prisma transaction client (optional)
   * @param {string} idempotencyKey - Idempotency key
   * @returns {Promise<Object|null>} Order
   */
  async getOrderByIdempotencyKey(tx, idempotencyKey) {
    const client = tx || prisma;

    // idempotencyKey does not exist in Order model
    // idempotency handling is managed by IdempotencyKey table via middleware
    return null;
  }

  /**
   * Get order by reference ID
   * @param {Object} tx - Prisma transaction client (optional)
   * @param {string} productId - Product ID
   * @param {string} referenceId - Reference ID
   * @returns {Promise<Object|null>} Order
   */
  async getOrderByReferenceId(tx, productId, referenceId) {
    const client = tx || prisma;

    return client.order.findFirst({
      where: {
        productId,
        referenceId,
      },
      include: {
        items: true,
        payments: {
          include: {
            refunds: true,
          },
        },
        productUser: true,
      },
    });
  }

  /**
   * Get order with its latest payment by order ID
   * @param {Object} tx - Prisma transaction client (optional)
   * @param {string} productId - Product ID
   * @param {string} orderId - Order ID
   * @returns {Promise<Object|null>} Order
   */
  async getOrderWithLatestPayment(tx, productId, orderId) {
    const client = tx || prisma;
    
    if (!orderId) return null;

    return client.order.findFirst({
      where: {
        id: orderId,
        productId
      },
      include: {
        payments: {
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      }
    });
  }

  /**
   * Get orders with pagination and filters
   * @param {Object} tx - Prisma transaction client (optional)
   * @param {Object} filters - Filter options
   * @returns {Promise<Object>} Orders and pagination info
   */
  async getOrders(tx, filters = {}) {
    const client = tx || prisma;

    const {
      productId,
      page = 1,
      limit = 10,
      status,
      startDate,
      endDate,
    } = filters;

    const where = { productId };

    if (status) {
      where.status = status;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [orders, total] = await Promise.all([
      client.order.findMany({
        where,
        include: {
          items: true,
          payments: {
            include: {
              refunds: true,
            },
          },
          productUser: {
            select: {
              externalUserId: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
      }),
      client.order.count({ where }),
    ]);

    return {
      orders,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    };
  }

  /**
   * Update order status
   * @param {Object} tx - Prisma transaction client (optional)
   * @param {string} orderId - Order ID
   * @param {string} status - New status
   * @returns {Promise<Object>} Updated order
   */
  async updateOrderStatus(tx, orderId, status) {
    const client = tx || prisma;

    return client.order.update({
      where: { id: orderId },
      data: { status },
      include: {
        items: true,
        payments: true,
      },
    });
  }

  /**
   * Update order
   * @param {Object} tx - Prisma transaction client (optional)
   * @param {string} orderId - Order ID
   * @param {Object} data - Update data
   * @returns {Promise<Object>} Updated order
   */
  async updateOrder(tx, orderId, data) {
    const client = tx || prisma;

    return client.order.update({
      where: { id: orderId },
      data,
    });
  }
}

module.exports = new OrderDAO();
