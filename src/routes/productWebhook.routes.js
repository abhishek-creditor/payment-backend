const express = require("express");
const controller = require("../controllers/productWebhook.controller");

const router = express.Router();

// Admin routes
router.post("/", controller.create);
router.get("/", controller.getAll);
router.get("/:id", controller.getById);
router.get("/product/:productId", controller.getByProduct);
router.put("/:id", controller.update);
router.delete("/:id", controller.remove);

module.exports = router;