const productPlanDao = require("../dao/productPlan.dao");
const productPlanService = require("../services/productPlan.service");
const EBOOK_PRODUCT_ID =
  process.env.EBOOK_PRODUCT_ID || "5d08e409-3dc6-4584-82ea-5e29af446144";

exports.createPlan = async (req, res) => {
  try {

    const { productId } = req.body;
    console.log("Creating plan for productId:", productId);
    // Ebook Flow
    if (productId === EBOOK_PRODUCT_ID) {
      const ebook = await productPlanService.createPlanService(req.body);

      return res.status(201).json({
        success: true,
        Plan_id: ebook.id,
        productId: ebook.productId,
        bookId: ebook.bookId,
      });
    }

    // Default Flow (Non Ebook)
    const plan = await productPlanDao.createPlan(req.body);

    res.status(201).json({
      success: true,
      data: plan,
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get All Plans (with optional product name filter)
exports.getAllPlans = async (req, res) => {
  try {
    const { productName } = req.query;

    const plans = await productPlanDao.getAllPlans(productName);

    res.status(200).json({
      success: true,
      count: plans.length,
      data: plans,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get Plan by ID
exports.getPlanById = async (req, res) => {
  try {
    const { id } = req.params;

    const plan = await productPlanDao.getPlanById(id);

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: "Plan not found",
      });
    }

    res.status(200).json({
      success: true,
      data: plan,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Update Plan
exports.updatePlan = async (req, res) => {
  try {
    const { id } = req.params;

    const updatedPlan = await productPlanDao.updatePlan(id, req.body);

    res.status(200).json({
      success: true,
      data: updatedPlan,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Delete Plan
exports.deletePlan = async (req, res) => {
  try {
    const { id } = req.params;

    await productPlanDao.deletePlan(id);

    res.status(200).json({
      success: true,
      message: "Plan deleted successfully",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
