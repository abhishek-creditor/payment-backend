const crudservice = require("../services/CRUD.services");

// ─── Helpers ────────────────────────────────────────────────

/**
 * Wrap async handler with consistent error response.
 * Prisma P2025 = "Record not found" on update/delete.
 */
function safeError(res, error) {
  console.error("CRUD error:", error);

  if (error?.code === "P2025") {
    return res.status(404).json({ success: false, message: "Record not found" });
  }
  if (error?.code === "P2003") {
    return res.status(400).json({ success: false, message: "Foreign key constraint failed — referenced record does not exist" });
  }

  const message =
    process.env.NODE_ENV === "production"
      ? "Internal server error"
      : error.message || "Internal server error";

  return res.status(500).json({ success: false, message });
}

// ─── Orders ─────────────────────────────────────────────────

exports.createOrder = async (req, res) => {
  try {
    const order = await crudservice.createOrder(req.body);
    res.status(201).json(order);
  } catch (error) {
    safeError(res, error);
  }
};

exports.getAllOrder = async (req, res) => {
  try {
    const { productId, planId } = req.query;
    const orders = await crudservice.getOrders({ productId, planId });
    res.json(orders);
  } catch (error) {
    safeError(res, error);
  }
};

exports.getOrderById = async (req, res) => {
  try {
    const order = await crudservice.getOrderById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    res.json(order);
  } catch (error) {
    safeError(res, error);
  }
};

exports.updateOrder = async (req, res) => {
  try {
    const order = await crudservice.updateOrder(req.params.id, req.body);
    res.json(order);
  } catch (error) {
    safeError(res, error);
  }
};

exports.deleteOrder = async (req, res) => {
  try {
    await crudservice.deleteOrder(req.params.id);
    res.status(204).end();
  } catch (error) {
    safeError(res, error);
  }
};

// ─── Payments ───────────────────────────────────────────────

exports.createPayment = async (req, res) => {
  try {
    const payment = await crudservice.createPayment(req.body);
    res.status(201).json(payment);
  } catch (error) {
    safeError(res, error);
  }
};

exports.getAllPayment = async (req, res) => {
  try {
    const { status } = req.query;
    const payments = await crudservice.getPayments({ status });
    res.json(payments);
  } catch (error) {
    safeError(res, error);
  }
};

exports.getPaymentById = async (req, res) => {
  try {
    const payment = await crudservice.getPaymentById(req.params.id);
    if (!payment) return res.status(404).json({ success: false, message: "Payment not found" });
    res.json(payment);
  } catch (error) {
    safeError(res, error);
  }
};

exports.updatePayment = async (req, res) => {
  try {
    const payment = await crudservice.updatePayment(req.params.id, req.body);
    res.json(payment);
  } catch (error) {
    safeError(res, error);
  }
};

exports.deletePayment = async (req, res) => {
  try {
    await crudservice.deletePayment(req.params.id);
    res.status(204).end();
  } catch (error) {
    safeError(res, error);
  }
};

// ─── Refunds ────────────────────────────────────────────────

exports.createRefund = async (req, res) => {
  try {
    const refund = await crudservice.createRefund(req.body);
    res.status(201).json(refund);
  } catch (error) {
    safeError(res, error);
  }
};

exports.getAllRefund = async (req, res) => {
  try {
    const refunds = await crudservice.getRefunds();
    res.json(refunds);
  } catch (error) {
    safeError(res, error);
  }
};

exports.getRefundById = async (req, res) => {
  try {
    const refund = await crudservice.getRefundById(req.params.id);
    if (!refund) return res.status(404).json({ success: false, message: "Refund not found" });
    res.json(refund);
  } catch (error) {
    safeError(res, error);
  }
};

exports.updateRefund = async (req, res) => {
  try {
    const refund = await crudservice.updateRefund(req.params.id, req.body);
    res.json(refund);
  } catch (error) {
    safeError(res, error);
  }
};

exports.deleteRefund = async (req, res) => {
  try {
    await crudservice.deleteRefund(req.params.id);
    res.status(204).end();
  } catch (error) {
    safeError(res, error);
  }
};