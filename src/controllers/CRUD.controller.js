const crudservice = require("../services/CRUD.services");

exports.createOrder = async (req, res) => {
  const order = await crudservice.createOrder(req.body);
  res.json(order);
};

exports.getAllOrder = async (req, res) => {
  const { productId, planId } = req.query;

  const orders = await crudservice.getOrders({ productId, planId });
  res.json(orders);
};

exports.getOrderById = async (req, res) => {
  const order = await crudservice.getOrderById(req.params.id);
  res.json(order);
};

exports.updateOrder = async (req, res) => {
  const order = await crudservice.updateOrder(req.params.id, req.body);
  res.json(order);
};

exports.deleteOrder = async (req, res) => {
  await crudservice.deleteOrder(req.params.id);
  res.json({ message: "Order deleted successfully" });
};

exports.createPayment = async (req, res) => {
  const payment = await crudservice.createPayment(req.body);
  res.json(payment);
};

exports.getAllPayment = async (req, res) => {
  const { status } = req.query;

  const payments = await crudservice.getPayments({ status });
  res.json(payments);
};

exports.getPaymentById = async (req, res) => {
  const payment = await crudservice.getPaymentById(req.params.id);
  res.json(payment);
};

exports.updatePayment = async (req, res) => {
  const payment = await crudservice.updatePayment(req.params.id, req.body);
  res.json(payment);
};

exports.deletePayment = async (req, res) => {
  await crudservice.deletePayment(req.params.id);
  res.json({ message: "Payment deleted successfully" });
};

//refund
exports.createRefund = async (req, res) => {
  try {
    const refund = await crudservice.createRefund(req.body);
    res.json(refund);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.getAllRefund = async (req, res) => {
  const refunds = await crudservice.getRefunds();
  res.json(refunds);
};

exports.getRefundById = async (req, res) => {
  const refund = await crudservice.getRefundById(req.params.id);
  res.json(refund);
};

exports.updateRefund = async (req, res) => {
  const refund = await crudservice.updateRefund(req.params.id, req.body);
  res.json(refund);
};

exports.deleteRefund = async (req, res) => {
  await crudservice.deleteRefund(req.params.id);
  res.json({ message: "Refund deleted successfully" });
};