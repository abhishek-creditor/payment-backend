// middlewares/productPlan.validation.js

const validateCreatePlan = (req, res, next) => {
  const {
    productId,
    name,
    description,
    price,
    billingType,
    interval,
    intervalCount,
  } = req.body;

  // Required fields
  if (!productId || !name || price == null || !billingType) {
    return res.status(400).json({
      success: false,
      message:
        "productId, code, name, price and billingType are required",
    });
  }

  // Name validation
  if (typeof name !== "string" || name.trim().length === 0) {
    return res.status(400).json({
      success: false,
      message: "name must be a valid non-empty string",
    });
  }

  req.body.name = name.trim();

  // Description validation (NEW)
  if (description !== undefined) {
    if (typeof description !== "string") {
      return res.status(400).json({
        success: false,
        message: "description must be a string",
      });
    }

    if (description.length > 500) {
      return res.status(400).json({
        success: false,
        message: "description cannot exceed 500 characters",
      });
    }

    req.body.description = description.trim();
  }

  // Price validation
  if (typeof price !== "number" || price < 0) {
    return res.status(400).json({
      success: false,
      message: "price must be a positive number",
    });
  }

  // Billing type validation
  const allowedBillingTypes = ["ONE_TIME", "RECURRING"];
  if (!allowedBillingTypes.includes(billingType)) {
    return res.status(400).json({
      success: false,
      message: "Invalid billingType",
    });
  }

  // Recurring validation
  if (billingType === "RECURRING") {
    if (!interval || !intervalCount) {
      return res.status(400).json({
        success: false,
        message:
          "interval and intervalCount are required for RECURRING plans",
      });
    }

    const allowedIntervals = ["DAY", "WEEK", "MONTH", "YEAR"];
    if (!allowedIntervals.includes(interval)) {
      return res.status(400).json({
        success: false,
        message: "Invalid billing interval",
      });
    }

    if (typeof intervalCount !== "number" || intervalCount <= 0) {
      return res.status(400).json({
        success: false,
        message: "intervalCount must be greater than 0",
      });
    }
  }

  // ONE_TIME cleanup
  if (billingType === "ONE_TIME") {
    req.body.interval = null;
    req.body.intervalCount = null;
  }

  next();
};

module.exports = {
  validateCreatePlan,
};