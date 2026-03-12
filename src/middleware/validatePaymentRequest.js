const { body, param, validationResult } = require("express-validator");

const handleValidation = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array().map(err => ({
        field: err.path,
        message: err.msg
      }))
    });
  }

  next();
};

/**
 * CREATE CHECKOUT SESSION VALIDATION
 */
exports.validateCreatePayment = [
  body()
    .custom((value, { req }) => {
      const id = req.body.externalUserId || req.body.productUserId;
      if (!id || typeof id !== "string" || id.trim() === "") {
        throw new Error("externalUserId or productUserId must be a valid string");
      }
      return true;
    }),

  body()
    .custom((value, { req }) => {
      const name = req.body.name || req.body.user_name || req.body.firstname;
      if (!name || typeof name !== "string" || name.trim() === "") {
        throw new Error("name, user_name, or firstname must be a valid string");
      }
      if (name.length > 100) {
        throw new Error("name must be under 100 characters");
      }
      return true;
    }),

  body()
    .custom((value, { req }) => {
      const email = req.body.email || req.body.user_email;
      if (!email) {
        throw new Error("email or user_email is required");
      }
      // Simple email validation regex
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        throw new Error("email must be valid");
      }
      return true;
    }),

  body("referenceId")
    .exists().withMessage("referenceId is required")
    .isString().withMessage("referenceId must be a string")
    .trim()
    .notEmpty().withMessage("referenceId cannot be empty"),

  body("platform_fee_amount")
    .optional()
    .isNumeric().withMessage("platform_fee_amount must be a number"),

  // ✅ PRODUCT PLAN ID REQUIRED (UUID string)
  body("productPlanId")
    .exists().withMessage("productPlanId is required")
    .isString().withMessage("productPlanId must be a string")
    .trim()
    .notEmpty().withMessage("productPlanId cannot be empty"),

  handleValidation
];

/**
 * CONFIRM SUBSCRIPTION PAYMENT VALIDATION
 */
exports.validateConfirmPayment = [
  body("orderId")
    .exists().withMessage("orderId is required")
    .isString().withMessage("orderId must be a string")
    .trim()
    .notEmpty().withMessage("orderId cannot be empty"),

  body("payment_method_id")
    .exists().withMessage("payment_method_id is required")
    .isString().withMessage("payment_method_id must be a string")
    .trim()
    .notEmpty().withMessage("payment_method_id cannot be empty"),

  handleValidation
];