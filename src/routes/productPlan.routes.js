const express = require("express");
const router = express.Router();
const productPlanController = require("../controllers/productPlan.controller");
const {validateCreatePlan} = require("../middleware/validateProductPlan");

router.post("/",validateCreatePlan,productPlanController.createPlan);
router.get("/", productPlanController.getAllPlans); // ?productName=Course
router.get("/:id", productPlanController.getPlanById);
router.put("/:id", productPlanController.updatePlan);
router.delete("/:id", productPlanController.deletePlan);

// router.post("/",productPlanController.createPlan); // For testing without validation middleware

module.exports = router;