const crypto = require("crypto");
const prisma = require("../utils/prisma");

module.exports = async function idempotency(req, res, next) {
  const key = req.header("Idempotency-Key");
  if (!key) return next();

  const productId = req.productId;
  if (!productId) return next();

  const method = req.method;
  const path = (req.originalUrl || req.url || "").split("?")[0];
  const requestHash = crypto
    .createHash("sha256")
    .update(JSON.stringify({ body: req.body ?? null, query: req.query ?? null }))
    .digest("hex");

  const ttlSeconds = Number.parseInt(process.env.IDEMPOTENCY_TTL_SECONDS || "86400", 10);
  const expiresAt = new Date(Date.now() + (Number.isFinite(ttlSeconds) ? ttlSeconds : 86400) * 1000);

  // Make idempotency key available to downstream handlers/services
  if (req.body && typeof req.body === "object" && req.body.idempotencyKey == null) {
    req.body.idempotencyKey = key;
  }

  const uniqueWhere = {
    productId_key_method_path: { productId, key, method, path }
  };

  // Cleanup of expired record (best-effort)
  try {
    await prisma.idempotencyKey.deleteMany({
      where: {
        productId,
        key,
        method,
        path,
        expiresAt: { lt: new Date() }
      }
    });
  } catch (e) {
    // ignore cleanup errors
  }

  let record;
  try {
    record = await prisma.idempotencyKey.create({
      data: {
        productId,
        apiKeyId: req.apiKey?.id || null,
        key,
        method,
        path,
        requestHash,
        status: "IN_PROGRESS",
        expiresAt
      }
    });
  } catch (e) {
    // Likely unique constraint conflict -> fetch existing
    record = await prisma.idempotencyKey.findUnique({ where: uniqueWhere });
  }

  if (record) {
    if (record.requestHash !== requestHash) {
      return res.status(409).json({
        error: "Idempotency-Key reuse with different request payload",
        message: "Use a new Idempotency-Key for a different request."
      });
    }

    if (record.status === "COMPLETED" && record.responseBody != null) {
      return res
        .status(record.responseStatusCode || 200)
        .json(record.responseBody);
    }

    if (record.status === "IN_PROGRESS" && record.createdAt) {
      return res.status(409).json({
        error: "Request with this Idempotency-Key is still processing",
        message: "Retry with the same Idempotency-Key after a short delay."
      });
    }
  }

  const recordId = record?.id;
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);
  const originalStatus = res.status.bind(res);

  res.status = (code) => {
    res.__idemStatusCode = code;
    return originalStatus(code);
  };

  async function finalize(body) {
    const statusCode = res.__idemStatusCode ?? res.statusCode ?? 200;

    // Don't cache 5xx responses to allow retries
    if (!recordId || statusCode >= 500) return;

    try {
      await prisma.idempotencyKey.update({
        where: { id: recordId },
        data: {
          status: "COMPLETED",
          responseStatusCode: statusCode,
          responseBody: body
        }
      });
    } catch (e) {
      // If we fail to store, do not block response; record will eventually expire
      console.error("[idempotency] Failed to finalize record", recordId, e);
    }
  }

  res.json = (body) => {
    finalize(body).finally(() => {});
    return originalJson(body);
  };

  res.send = (body) => {
    // Only cache JSON-like responses; otherwise just pass through.
    let parsed = null;
    if (typeof body === "object" && body !== null) parsed = body;
    else if (typeof body === "string") {
      try {
        parsed = JSON.parse(body);
      } catch (e) {
        parsed = null;
      }
    }
    if (parsed != null) {
      finalize(parsed).finally(() => {});
    }
    return originalSend(body);
  };

  return next();
};
