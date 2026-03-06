const service = require("../services/productWebhook.service");

exports.create = async (req, res) => {
  try {
    const {
      productId,
      triggerEvent,
      callbackUrl,
      httpMethod,
      maxRetries,
      retryDelayMs
    } = req.body;

    // Required fields check
    if (!productId || !triggerEvent || !callbackUrl) {
      return res.status(400).json({
        message: "productId, triggerEvent and callbackUrl are required"
      });
    }

    // URL validation
    try {
      new URL(callbackUrl);
    } catch {
      return res.status(400).json({
        message: "Invalid callbackUrl format"
      });
    }

    if (maxRetries !== undefined && maxRetries < 0) {
      return res.status(400).json({
        message: "maxRetries must be >= 0"
      });
    }

    if (retryDelayMs !== undefined && retryDelayMs < 0) {
      return res.status(400).json({
        message: "retryDelayMs must be >= 0"
      });
    }

    const config = await service.createConfig(req.body);
    console.log(`Created new webhook config with ID: ${config.id} for product ${productId} and event ${triggerEvent}`);
    res.status(201).json(config);

  } catch (err) {
    res.status(500).json({
      message: "Hey I'm Controller Some error occurred while creating webhook config"
    });
  }
};
exports.getAll = async (req, res) => {
  const configs = await service.getAllConfigs();
  res.json(configs);
};

exports.getById = async (req, res) => {
  try {
    const config = await service.getConfigById(req.params.id);
    res.json(config);
  } catch (err) {
    res.status(404).json({ message: err.message });
  }
};

exports.getByProduct = async (req, res) => {
  const configs = await service.getByProduct(req.params.productId);
  res.json(configs);
};

exports.update = async (req, res) => {
  try {
    const config = await service.updateConfig(req.params.id, req.body);
    res.json(config);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.remove = async (req, res) => {
  try {
    await service.deleteConfig(req.params.id);
    res.json({ message: "Deleted successfully" });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};