const crypto = require("crypto");
const stringify = require("fast-json-stable-stringify");
const prisma = require("../utils/prisma");

const IDEMPOTENCY_TTL_SECONDS = parseInt(
  process.env.IDEMPOTENCY_TTL_SECONDS || "86400",
  10
);

const IN_PROGRESS_TIMEOUT_SECONDS = parseInt(
  process.env.IDEMPOTENCY_IN_PROGRESS_TIMEOUT || "60",
  10
);

/**
 * Production-Ready Idempotency Middleware
 * ---------------------------------------
 * Guarantees:
 * - Request replay safety
 * - Crash safety
 * - Concurrency safety
 * - Safe retries on 5xx
 * - Stable hashing
 * - Forwarding to Tilled
 */

module.exports = async function idempotency(req, res, next) {
  const key = req.header("Idempotency-Key");
  if (!key) return next();

  const productId = req.productId;
  if (!productId) return next();

  // Attach for downstream forwarding (CRITICAL)
  req.idempotencyKey = key;

  const method = req.method.toUpperCase();

  let path = (req.originalUrl || req.url || "").split("?")[0];
  if (path.endsWith("/") && path.length > 1) {
    path = path.slice(0, -1);
  }

  // Stable body hash
  const requestHash = crypto
    .createHash("sha256")
    .update(
      stringify({
        body: req.body ?? null,
        query: req.query ?? null,
      })
    )
    .digest("hex");

  const now = new Date();
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_SECONDS * 1000);

  const uniqueWhere = {
    productId_key_method_path: {
      productId,
      key,
      method,
      path,
    },
  };

  let record;
  let isOwner = false;

  try {
    // CREATE-FIRST pattern (atomic protection)
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
    console.log("Idempotency Key inserted");

    isOwner = true;
    res.setHeader("Idempotency-Replayed", "false");

  } catch {
    // Already exists
    console.log("Idempotency Key already exists");
    record = await prisma.idempotencyKey.findUnique({
      where: uniqueWhere,
    });

    if (!record) {
      return res.status(500).json({
        error: "Idempotency lookup failed",
      });
    }

    // Payload mismatch
    if (record.requestHash !== requestHash) {
      return res.status(409).json({
        error: "Idempotency-Key reused with different payload",
      });
    }

    // Replay if completed
    if (record.status === "COMPLETED") {
      res.setHeader("Idempotency-Replayed", "true");
      return res
        .status(200) // Changed to 200 for idempotency replayed payload
        .json(record.responseBody);
    }
    //for now code is not going forward from here

    // IN_PROGRESS handling
    const age =
      (Date.now() - new Date(record.createdAt).getTime()) / 1000;

    if (age < IN_PROGRESS_TIMEOUT_SECONDS) {
      return res.status(409).json({
        error: "Request is currently processing",
      });
    }

    // Stale lock recovery
    await prisma.idempotencyKey.update({
      where: { id: record.id },
      data: {
        requestHash,
        expiresAt,
        status: "IN_PROGRESS",
      },
    });

    isOwner = true;
    res.setHeader("Idempotency-Replayed", "false");
  }

  if (!isOwner) return;

  const recordId = record.id;

  const originalJson = res.json.bind(res);
  const originalStatus = res.status.bind(res);

  res.status = (code) => {
    res.__statusCode = code;
    return originalStatus(code);
  };

  res.json = async (body) => {
    try {
      const statusCode = res.__statusCode ?? 200;

      // 5xx from Tilled → allow retry
      if (statusCode >= 500) {
        await prisma.idempotencyKey.delete({
          where: { id: recordId },
        });
        return originalJson(body);
      }

      // Success or client error → finalize
      await prisma.idempotencyKey.update({
        where: { id: recordId },
        data: {
          status: "COMPLETED",
          responseStatusCode: statusCode,
          responseBody: body,
        },
      });

    } catch (err) {
      console.error("Idempotency finalize error:", err);
    }

    return originalJson(body);
  };

  next();
};