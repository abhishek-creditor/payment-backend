const crypto = require("crypto");
const stringify = require("fast-json-stable-stringify");
const prisma = require("../utils/prisma");

// 50 minutes TTL time (via .env) after that Record will auto-expire and allow new requests with same key and delete
const IDEMPOTENCY_TTL_SECONDS = parseInt(
  process.env.IDEMPOTENCY_TTL_SECONDS || "3000",
  10,
);

// In-Progress Timeout (e.g. 60 seconds) to prevent stale locks
// work only if system crash down etc.
const IN_PROGRESS_TIMEOUT_SECONDS = parseInt(
  process.env.IDEMPOTENCY_IN_PROGRESS_TIMEOUT || "60",
  10,
);

module.exports = async function idempotency(req, res, next) {
  const key = req.header("Idempotency-Key");
  if (!key) return next();

  const productId = req.productId;
  if (!productId) return next();

  req.idempotencyKey = key;

  const method = req.method.toUpperCase();

  let path = (req.originalUrl || req.url || "").split("?")[0];
  if (path.endsWith("/") && path.length > 1) {
    path = path.slice(0, -1);
  }

  const requestHash = crypto
    .createHash("sha256")
    .update(
      stringify({
        body: req.body ?? null,
        query: req.query ?? null,
      }),
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
    // CREATE-FIRST (Atomic Lock)
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

    isOwner = true;
    res.setHeader("Idempotency-Replayed", "false");
  } catch {
    record = await prisma.idempotencyKey.findUnique({
      where: uniqueWhere,
    });

    if (!record) {
      return res.status(500).json({
        error: "Idempotency lookup failed RECORD_NOT_FOUND",
      });
    }

    // TTL CLEANUP ONLY FOR FAILED / CANCELLED
    if (
      record.expiresAt &&
      record.expiresAt < new Date() &&
      (record.status === "FAILED" || record.status === "CANCELLED")
    ) {
      await prisma.idempotencyKey.delete({
        where: { id: record.id },
      });
      return next();
    }

    if (record.requestHash !== requestHash) {
      return res.status(409).json({
        error: "Idempotency-Key reused with different payload",
      });
    }

    // COMPLETED → Replay
    if (record.status === "COMPLETED") {
      res.setHeader("Idempotency-Replayed", "true");
      return res
        .status(record.responseStatusCode || 200)
        .json(record.responseBody);
    }

    // IN_PROGRESS Handling
    if (record.status === "IN_PROGRESS") {
      if (record.responseBody) {
        res.setHeader("Idempotency-Replayed", "true");
        return res
          .status(record.responseStatusCode || 200)
          .json(record.responseBody);
      }

      // IMPORTANT:
      // Prevent duplicate order creation using referenceId.
      // Even on retry or crash recovery, same order will be reused.
      // work only if system down, crash etc.
      const age = (Date.now() - new Date(record.createdAt).getTime()) / 1000;
      // 60 seonds se kam hai to processing me hai aur 60 seconds se zyada hai retry karlo
      if (age < IN_PROGRESS_TIMEOUT_SECONDS) {
        return res.status(409).json({
          error: "Request is currently processing",
        });
      }

      // Stale lock recovery
      await prisma.idempotencyKey.update({
        where: { id: record.id },
        data: {
          status: "IN_PROGRESS",
          requestHash,
          expiresAt,
        },
      });

      isOwner = true; // Allow this request to proceed Q ki ya Request new owner bana raha hai stale lock ka
      res.setHeader("Idempotency-Replayed", "false");
    }

    // FAILED / CANCELLED → Allow Retry
    if (record.status === "FAILED" || record.status === "CANCELLED") {
      await prisma.idempotencyKey.delete({
        where: { id: record.id },
      });
      return next();
    }
  }

  // IMPORTANT:
// Sirf wahi request idempotency record finalize karegi jo lock ki owner hai.
// Agar ye request owner nahi hai (duplicate / replay case),
// to aage ka status update logic run nahi hoga.
// Isse multiple requests ek hi record ko modify nahi kar sakti
// aur race condition prevent hoti hai.
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

      // 5xx → delete (retry allowed)
      if (statusCode >= 500) {
        await prisma.idempotencyKey.delete({
          where: { id: recordId },
        });
        return originalJson(body);
      }

      // SAFE STATUS MAPPING
      const paymentStatus = body?.status || body?.data?.payments?.[0]?.status;

      // If status not found → allow safe retry
      if (!paymentStatus) {
        await prisma.idempotencyKey.delete({
          where: { id: recordId },
        });
        return originalJson(body);
      }

      let finalStatus;

      if (paymentStatus === "FAILED") {
        finalStatus = "FAILED";
      } else if (paymentStatus === "CANCELLED") {
        finalStatus = "CANCELLED";
      } else if (
        paymentStatus === "INITIATED" ||
        paymentStatus === "PROCESSING"
      ) {
        finalStatus = "IN_PROGRESS";
      } else if (paymentStatus === "SUCCEEDED") {
        finalStatus = "COMPLETED";
      }

      await prisma.idempotencyKey.update({
        where: { id: recordId },
        data: {
          status: finalStatus,
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
