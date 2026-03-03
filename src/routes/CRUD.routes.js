const express = require("express");
const router = express.Router();
const controller = require("../controllers/CRUD.controller");

router.post("/order", controller.createOrder);
router.get("/order", controller.getAllOrder);  // filter: ?productId=xxx&planId=xxx
router.get("/order/:id", controller.getOrderById);
router.put("/order/:id", controller.updateOrder);
router.delete("/order/:id", controller.deleteOrder);




router.post("/payment", controller.createPayment);
router.get("/payment", controller.getAllPayment);  // filter: ?status=SUCCESS
router.get("/payment/:id", controller.getPaymentById);
router.put("/payment/:id", controller.updatePayment);
router.delete("/payment/:id", controller.deletePayment);


router.post("/refund", controller.createRefund);
router.get("/refund", controller.getAllRefund);
router.get("/refund/:id", controller.getRefundById);
router.put("/refund/:id", controller.updateRefund);
router.delete("/refund/:id", controller.deleteRefund);
module.exports = router;