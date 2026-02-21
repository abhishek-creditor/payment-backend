const crypto = require("crypto");
const prisma = require("../utils/prisma");

const IDEMPOTENCY_TTL_SECONDS = parseInt(
  process.env.IDEMPOTENCY_TTL_SECONDS || "86400",
  10,
); // 24h
const IN_PROGRESS_TIMEOUT_SECONDS = parseInt(
  process.env.IDEMPOTENCY_IN_PROGRESS_TIMEOUT || "60",
  10,
); // 60s

module.exports = async function idempotency(req, res, next) {
  const key = req.header("Idempotency-Key");
  if (!key) return next();

  const productId = req.productId;
  if (!productId) return next();

  const method = req.method.toUpperCase();

  // Normalize path (remove query + trailing slash)
  let path = (req.originalUrl || req.url || "").split("?")[0]; // remove query params
  if (path.endsWith("/") && path.length > 1) {
    path = path.slice(0, -1);
  }

  // server body or query ka hash bnao taki same key different payload pe reuse na ho
  const requestHash = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({ body: req.body ?? null, query: req.query ?? null }),
    )
    .digest("hex");

    // record kab expire hoga
  const now = new Date();
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_SECONDS * 1000);

  // unique constraint ke liye same combination of productId, key, method, path hona chahiye
  const uniqueWhere = {
    productId_key_method_path: {
      productId,
      key,
      method,
      path,
    },
  };

  let record;

  try {
    record = await prisma.idempotencyKey.findUnique({
      where: uniqueWhere,
    });
  } catch (err) {
    return res.status(500).json({ error: "Idempotency lookup failed" }); // aagar nahi mila to 500 error
  }

  // ================================
  // EXISTING RECORD HANDLING
  // ================================
  if (record) {
    // Expired → treat as new
    if (record.expiresAt && record.expiresAt < now) { // agar record expire ho chuka hai to delete kar do taki naya record create ho sake
      try {
        await prisma.idempotencyKey.delete({ where: { id: record.id } });
      } catch (e) {}
      record = null;
    } else {
      // Payload mismatch
      if (record.requestHash !== requestHash) { // !important same key but different body
        return res.status(409).json({
          error: "Idempotency-Key reused with different request payload",
          message: "Use a new Idempotency-Key for a different request.",
        });
      }

      // Completed → replay response
      if (record.status === "COMPLETED" && record.responseBody != null) {
        res.set("Idempotency-Replayed", "true"); // set in headers to indicate this is a replayed response
        return res
          .status(record.responseStatusCode || 200)
          .json(record.responseBody);
      }

      // In Progress → check if stale(progress me hai lekin bahut time ho gaya hai to stale ho sakta hai)
      if (record.status === "IN_PROGRESS") {
        const ageSeconds =
          (now.getTime() - new Date(record.createdAt).getTime()) / 1000;

        if (ageSeconds < IN_PROGRESS_TIMEOUT_SECONDS) {
          return res.status(409).json({
            error: "Request with this Idempotency-Key is still processing",
            message: "Retry after a short delay.",
          });
        }

        // Stale lock → allow retry by deleting
        try {
          await prisma.idempotencyKey.delete({ where: { id: record.id } });
          record = null;
        } catch (e) {
          return res.status(409).json({
            error: "Request is currently locked. Please retry shortly.",
          });
        }
      }
    }
  }

  // ================================
  // CREATE NEW RECORD
  // ================================
  if (!record) {
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
          expiresAt,
        },
      });
    } catch (err) {
      // Unique conflict fallback
      record = await prisma.idempotencyKey.findUnique({
        where: uniqueWhere,
      });

      if (record?.status === "COMPLETED") {
        return res
          .status(record.responseStatusCode || 200)
          .json(record.responseBody);
      }

      return res.status(409).json({
        error: "Duplicate request detected",
      });
    }
  }

  const recordId = record.id;

  // ================================
  // RESPONSE INTERCEPT
  // ================================
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);
  const originalStatus = res.status.bind(res);

  res.status = (code) => {
    res.__idemStatusCode = code;
    return originalStatus(code);
  };

  async function finalize(body) {
    const statusCode = res.__idemStatusCode ?? res.statusCode ?? 200;

    // Do not cache 5xx responses
    if (statusCode >= 500) return;

    try {
      await prisma.idempotencyKey.update({
        where: { id: recordId },
        data: {
          status: "COMPLETED",
          responseStatusCode: statusCode,
          responseBody: body,
        },
      });
    } catch (err) {
      console.error("[Idempotency] Finalize failed:", err);
    }
  }

  res.json = async (body) => { 
    res.set("Idempotency-Replayed", "false");
    await finalize(body);
    return originalJson(body);
  };

  res.send = async (body) => {
    let parsed = null;
    if (typeof body === "object" && body !== null) {
      parsed = body;
    } else if (typeof body === "string") {
      try {
        parsed = JSON.parse(body);
      } catch {}
    }

    if (parsed != null) {
      await finalize(parsed);
    }

    return originalSend(body);
  };

  return next();
};
