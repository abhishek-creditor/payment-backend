module.exports = function requireIdempotencyKey(req, res, next) {
  const key = req.header("Idempotency-Key");
  if (!key) {
    return res.status(400).json({
      error: "Idempotency-Key header is required for this request",
    });
  }
  next();
};