const cuid = require("cuid");
const productPlanDao = require("../dao/productPlan.dao");
const prisma = require("../config/prismaClient");

// Create Plan Service
async function createPlanService(data) {
  const { productId } = data;

  if (!productId) {
    const err = new Error("productId is required");
    err.statusCode = 400;
    throw err;
  }

  // Step 2: Fetch the product code from DB to avoid hardcoded IDs
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { code: true },
  });

  // Throw 404 if product not found in DB
  if (!product) {
    const err = new Error("Product not found");
    err.statusCode = 404;
    throw err;
  }

  // Step 3: only ebook specific logic Execute.
  if (product.code === "ebook") {
    return await createEbookPlan(data);
  }

  // Default Flow
  return await productPlanDao.createPlan(data);
}

// Ebook Specific Business Logic (Step 4 & 5)
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

  if (!name || price === undefined || price === null || !metadata || typeof metadata !== "object") {
    const err = new Error("name, price and metadata are required for Ebook plan");
    err.statusCode = 400;
    throw err;
  }

  if (!metadata.bookId) {
    const err = new Error("bookId is required inside metadata");
    err.statusCode = 400;
    throw err;
  }

  const bookId = metadata.bookId;

  // Step 4: Ebook-Specific Validation
  // Check if bookId already exists
  const existingBook = await productPlanDao.findPlanByBookId(bookId);

  if (existingBook) {
    const err = new Error("BookId already exists");
    err.statusCode = 400;
    throw err;
  }

  const payload = {
    productId,
    code: `EB_${cuid()}`,
    name,
    description: description || null,
    price,
    currency: currency || "usd",
    billingType: "ONE_TIME",
    interval: interval || null,
    intervalCount: intervalCount || null,
    metadata,
    isActive: true,
  };

  // Step 5: Execution
  const createdPlan = await productPlanDao.createPlan(payload);

  return {
    ...createdPlan,
    type: "EBOOK",
    bookId,
  };
}

module.exports = {
  createPlanService,
};