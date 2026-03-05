const dao = require("../dao/productWebhook.dao");

exports.createConfig = async (data) => {
  return dao.create(data);
};

exports.getAllConfigs = async () => {
  return dao.findAll();
};

exports.getConfigById = async (id) => {
  const config = await dao.findById(id);
  if (!config) throw new Error("Webhook config not found");
  return config;
};

exports.getByProduct = async (productId) => {
  return dao.findByProduct(productId);
};

exports.updateConfig = async (id, data) => {
  return dao.update(id, data);
};

exports.deleteConfig = async (id) => {
  return dao.remove(id);
};