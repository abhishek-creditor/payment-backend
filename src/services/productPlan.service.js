const cuid = require("cuid");
const productPlanDao = require("../dao/productPlan.dao");

const EBOOK_PRODUCT_ID = "5d08e409-3dc6-4584-82ea-5e29af446144";

// Create Plan Service
async function createPlanService(data) {
  const { productId } = data;

  if (!productId) {
    throw new Error("productId is required");
  }

  // Ebook Product Logic
  if (productId === EBOOK_PRODUCT_ID) {
    return await createEbookPlan(data);
  }

  // Default Flow
  return await productPlanDao.createPlan(data);
}

// Ebook Specific Business Logic
async function createEbookPlan(data) {
  console.log("Creating Ebook Plan for:", data.productId);

  const {
    productId,
    name,
    description,
    price,
    currency,
    metadata,
    interval,
    intervalCount,
  } = data;

  if (!name || !price || !metadata) {
    throw new Error("name, price and metadata are required for Ebook plan");
  }

  if (!metadata.bookId) {
    throw new Error("bookId is required inside metadata");
  }

  const bookId = metadata.bookId;

  const payload = {
    productId,
    code: `EB_${cuid()}`,
    name,
    description: description || null,
    price,
    currency: currency || "USD",
    billingType: "ONE_TIME",
    interval: interval || null,
    intervalCount: intervalCount || null,
    metadata,
    isActive: true,
  };

  const createdPlan = await productPlanDao.createPlan(payload);

  return {
    type: "EBOOK",
    id: createdPlan.id,
    productId: createdPlan.productId,
    bookId,
  };
}

module.exports = {
  createPlanService,
};
