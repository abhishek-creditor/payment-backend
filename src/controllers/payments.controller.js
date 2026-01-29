const service = require("../services/payments.service");

exports.createPayment = async (req, res) => {
  const payment = await service.createPayment(req.tenantId, req.body);
  res.status(201).json(payment);
};
