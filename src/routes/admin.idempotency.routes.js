const express = require("express");
const router = express.Router();

const controller = require("../controllers/admin.idempotency.controller");
const adminOnly = require("../middleware/admin.middleware");

// --> Apply admin middleware to all routes below
router.use(adminOnly);

// Get all idempotency keys (full data)
router.get("/", controller.getAllKeys);

// Get summary (id + key + status)
router.get("/summary", controller.getKeySummary);

// Get single by ID
router.get("/:id", controller.getById);


// --> UPDATE API
router.put("/:id", controller.updateKey);

// --> DELETE APIs

// Delete by ID (optional ?force=true)
router.delete("/:id", controller.deleteById);

// Delete many expired IN_PROGRESS (manual trigger / cron reuse)
router.delete(
  "/cleanup/expired-in-progress",
  controller.deleteExpiredInProgress
);

module.exports = router;