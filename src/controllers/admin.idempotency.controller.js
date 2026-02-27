const service = require("../services/admin.idempotency.service");

/**
 * Get all idempotency keys (full data)
 */
async function getAllKeys(req, res) {
  try {
    const data = await service.getAllKeys();

    return res.json({
      success: true,
      data
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

/**
 * Get summary (id + key + status)
 */
async function getKeySummary(req, res) {
  try {
    const data = await service.getKeySummary();

    return res.json({
      success: true,
      data
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

/**
 * Get single idempotency key by ID
 */
async function getById(req, res) {
  try {
    const { id } = req.params;
    console.log("Fetching idempotency key with ID:", id);
    const data = await service.getById(id);

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Idempotency key not found"
      });
    }

    return res.json({
      success: true,
      data
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

// --> Update idempotency key
async function updateKey(req, res) {
  try {
    const { id } = req.params;
    const updated = await service.updateKey(id, req.body);

    return res.json({
      success: true,
      message: "Idempotency key updated successfully",
      data: updated
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }
}

/**
 * Delete by ID
 * Optional: ?force=true
 */
async function deleteById(req, res) {
  try {
    const { id } = req.params;
    const force = req.query.force === "true";

    await service.deleteById(id, force);

    return res.json({
      success: true,
      message: "Idempotency key deleted successfully"
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }
}

/**
 * Delete expired IN_PROGRESS (manual or cron trigger)
 */
async function deleteExpiredInProgress(req, res) {
  try {
    const result = await service.deleteExpiredInProgress();

    return res.json({
      success: true,
      message: "Expired IN_PROGRESS keys deleted",
      deletedCount: result.count
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

module.exports = {
  getAllKeys,
  getKeySummary,
  getById,
  updateKey,
  deleteById,
  deleteExpiredInProgress
};