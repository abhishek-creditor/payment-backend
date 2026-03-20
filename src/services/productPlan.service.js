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

  let {
    productId,
    name,
    description,
    price,
    currency,
    metadata,
    interval,
    intervalCount,
  } = data;

  const billingType = (data.billingType || "ONE_TIME").toUpperCase();

  // Trim name remove extra spaces. 
  if (typeof name === "string") {
    name = name.trim();
  }

  // Basic validation
  if (!name || price === undefined || price === null) {
    const err = new Error("name and price are required for Ebook plan");
    err.statusCode = 400;
    throw err;
  }

  if (typeof price !== "number" || price < 0) {
    const err = new Error("price must be a valid non-negative number");
    err.statusCode = 400;
    throw err;
  }

  // metadata validation (no array allowed)
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    const err = new Error("metadata must be a valid object");
    err.statusCode = 400;
    throw err;
  }

  // Clean metadata remove null and undefine data in metadata
  const cleanMetadata = {};
  for (const key in metadata) {
    if (metadata[key] !== undefined && metadata[key] !== null) {
      cleanMetadata[key] = metadata[key];
    }
  }
  metadata = cleanMetadata;

  const bookId = metadata.bookId;

  // Subscription logic
  if (billingType === "RECURRING") {
    const validIntervals = ["DAY", "WEEK", "MONTH", "YEAR"];

    const normalizedInterval = interval ? interval.toUpperCase() : null; // convert interval month -> MONTH uppercase

    if (!normalizedInterval || !validIntervals.includes(normalizedInterval)) {
      const err = new Error(
        "valid interval is required for subscription (DAY, WEEK, MONTH, YEAR)"
      );
      err.statusCode = 400;
      throw err;
    }

    interval = normalizedInterval;

    if (bookId !== undefined) {
      const err = new Error("bookId should not be provided for subscription plans");
      err.statusCode = 400;
      throw err;
    }
  } else {
    // check Purchase logic -> bookId is required inside metadata
    if (!bookId) {
      const err = new Error("bookId is required inside metadata");
      err.statusCode = 400;
      throw err;
    }

    // check book is already exist or not 
    const existingBook = await productPlanDao.findPlanByBookId(bookId);

    if (existingBook) {
      const err = new Error("BookId already exists");
      err.statusCode = 400;
      throw err;
    }
  }

  const payload = {
    productId,
    code: `EB_${cuid()}`,
    name,
    description: description || null,
    price,
    // currency normalized
    currency: (currency || "usd").toLowerCase(),
    billingType,
    interval: interval || null,
    intervalCount: intervalCount || null,
    metadata,
    isActive: true,
  };

  // Step 5: Execution
  const createdPlan = await productPlanDao.createPlan(payload);

  const response = {
    ...createdPlan,
    type: "EBOOK",
  };

  if (billingType !== "RECURRING") {
    response.bookId = bookId;
  }

  return response;
}

module.exports = {
  createPlanService,
};