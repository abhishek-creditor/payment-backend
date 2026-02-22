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
  body("externalUserId")
    .exists().withMessage("externalUserId is required")
    .isString().withMessage("externalUserId must be a string")
    .trim()
    .notEmpty().withMessage("externalUserId cannot be empty"),

  body("name")
    .exists().withMessage("name is required")
    .isString().withMessage("name must be a string")
    .trim()
    .notEmpty().withMessage("name cannot be empty")
    .isLength({ max: 100 }).withMessage("name must be under 100 characters"),

  body("email")
    .exists().withMessage("email is required")
    .isEmail().withMessage("email must be valid")
    .normalizeEmail(),

  body("referenceId")
    .exists().withMessage("referenceId is required")
    .isString().withMessage("referenceId must be a string")
    .trim()
    .notEmpty().withMessage("referenceId cannot be empty"),

  // ✅ PLAN CODE REQUIRED (string OR number)
  body("plan_code")
    .exists().withMessage("plan_code is required")
    .custom(value => {
      if (typeof value === "string" && value.trim() !== "") return true;
      if (typeof value === "number") return true;
      throw new Error("plan_code must be a non-empty string or number");
    }),

  handleValidation
];