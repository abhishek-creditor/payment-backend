const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const idempotency = require("../middleware/idempotency");
const controller = require("../controllers/payments.controller");

router.post("/", auth, idempotency, controller.createPayment);

module.exports = router;
