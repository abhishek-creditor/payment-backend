const { body, validationResult } = require("express-validator");

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
 * CREATE SUBSCRIPTION VALIDATION
 */
exports.validateCreateSubscription = [
    body("externalUserId")
        .exists().withMessage("externalUserId is required")
        .isString().withMessage("externalUserId must be a string")
        .trim()
        .notEmpty().withMessage("externalUserId cannot be empty"),

    body("productPlanId")
        .exists().withMessage("productPlanId is required")
        .isString().withMessage("productPlanId must be a string")
        .trim()
        .notEmpty().withMessage("productPlanId cannot be empty"),

    body("paymentMethodId")
        .exists().withMessage("paymentMethodId is required")
        .isString().withMessage("paymentMethodId must be a string")
        .trim()
        .notEmpty().withMessage("paymentMethodId cannot be empty"),

    body("tilledAccountId")
        .exists().withMessage("tilledAccountId is required")
        .isString().withMessage("tilledAccountId must be a string")
        .trim()
        .notEmpty().withMessage("tilledAccountId cannot be empty"),

    body("billingCycleAnchor")
        .optional()
        .isString().withMessage("billingCycleAnchor must be an ISO8601 date string"),

    handleValidation
];
