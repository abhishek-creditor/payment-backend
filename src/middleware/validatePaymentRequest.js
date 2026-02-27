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
      const name = req.body.name || req.body.user_name;
      if (!name || typeof name !== "string" || name.trim() === "") {
        throw new Error("name or user_name must be a valid string");
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