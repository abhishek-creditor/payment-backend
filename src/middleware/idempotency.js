const crypto = require("crypto");
const stringify = require("fast-json-stable-stringify");
const prisma = require("../config/prismaClient");
const { IdempotencyStatus } = require("@prisma/client");

// 50 minutes TTL time (via .env) after that Record will auto-expire and allow new requests with same key and delete
const IDEMPOTENCY_TTL_SECONDS = parseInt(
  process.env.IDEMPOTENCY_TTL_SECONDS || "3000",
  10,
);

// In-Progress Timeout (e.g. 60 seconds) to prevent stale locks. work only if system crash down etc.
const IN_PROGRESS_TIMEOUT_SECONDS = parseInt(
  process.env.IDEMPOTENCY_IN_PROGRESS_TIMEOUT || "60",
  10,
);

module.exports = async function idempotency(req, res, next) {
  const key = req.header("Idempotency-Key");
  if (!key) return next();

  const productId = req.productId; // Assuming productId is set in req by previous middleware

  console.log(
    "[Idempotency Middleware] Received request with Idempotency-Key: %s and product ID: %s",
    key,
    productId,
  );
  if (!productId) return next();

  req.idempotencyKey = key;

  const method = req.method.toUpperCase();

  let path = (req.originalUrl || req.url || "").split("?")[0];
  if (path.endsWith("/") && path.length > 1) {
    path = path.slice(0, -1);
  }

  // --- CHECK REFERENCE ID ALREADY EXIST RETURN RESPONSE ALREADY PAID ---
  console.log("[Idempotency] Checking for existing orders with productId and referenceId...");
  const referenceId = req.body?.referenceId || req.body?.orderId;

  if (productId && referenceId) {
    const existingOrder = await prisma.order.findUnique({
      where: {
        productId_referenceId: {
          productId,
          referenceId, // product ki order id
        },
      },
      select: { status: true } // Sirf status fetch karna fast hota hai
    });

    // Check karein agar status already PAID ya SUCCEEDED hai
    if (existingOrder && existingOrder.status === "PAID") {
      return res.status(200).json({
        error: "Order already paid",
        message: `Order is already paid for this reference ID: ${referenceId}`,
        status: existingOrder.status
      });
    }
  }

  // --- Request body ka hash banayein taaki same key ke different payloads ko detect kar sakein ---
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
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_SECONDS * 1000); // Record expiration time for safe retry after TTL expiration

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
    // ─── STEP 1: Atomic CREATE (optimistic lock) ──────────────────────────────
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
    console.log("[Idempotency] New lock created, owner:", record.id);
  } catch {
    console.log("Idempotency Key already exists, fetching record...");

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
      record.expiresAt <= new Date() &&
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

    if (record.status === "IN_PROGRESS") {
      if (record.responseBody) {
        res.setHeader("Idempotency-Replayed", "true");
        return res
          .status(record.responseStatusCode || 200)
          .json(record.responseBody);
      }

      const age = (Date.now() - new Date(record.createdAt).getTime()) / 1000;

      if (age < IN_PROGRESS_TIMEOUT_SECONDS) {
        return res.status(409).json({
          error: "Request is currently processing",
        });
      }

      try {
        record = await prisma.idempotencyKey.update({
          where: {
            id: record.id,
            status: "IN_PROGRESS",
            createdAt: {
              lt: new Date(Date.now() - IN_PROGRESS_TIMEOUT_SECONDS * 1000),
            },
          },
          data: {
            requestHash,
            expiresAt,
          },
        });

        isOwner = true;
        res.setHeader("Idempotency-Replayed", "false");
      } catch {
        return res.status(409).json({
          error: "A request with this Idempotency-Key is already in progress.",
        });
      }
    }

    if (record.status === "FAILED" || record.status === "CANCELLED") {
      const { count } = await prisma.idempotencyKey.deleteMany({
        where: {
          id: record.id,
          status: { in: ["FAILED", "CANCELLED"] },
        },
      });

      if (count === 0) {
        return res.status(409).json({
          error: "A request with this Idempotency-Key is already in progress.",
        });
      }

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
    }
  }

  if (!isOwner) {
    console.warn(
      "[Idempotency] Reached owner gate without owning lock — dropping.",
    );
    return res.status(409).json({
      error: "A request with this Idempotency-Key is already in progress.",
    });
  }

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

      if (statusCode >= 500) {
        await prisma.idempotencyKey.delete({
          where: { id: recordId },
        });
        return originalJson(body);
      }

      const paymentStatus = body?.status || body?.data?.payments?.[0]?.status;

      if (!paymentStatus) {
        // No payment status in body — keep record as IN_PROGRESS, save the response
        const curr = await prisma.idempotencyKey.findUnique({
          where: { id: record.id },
        });
        if (
          curr &&
          !["FAILED", "CANCELLED", "COMPLETED"].includes(curr.status)
        ) {
          await prisma.idempotencyKey.update({
            where: { id: record.id },
            data: {
              responseStatusCode: statusCode,
              responseBody: body,
            },
          });
        }
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
      } else {
        finalStatus =
          statusCode >= 200 && statusCode < 300 ? "COMPLETED" : "FAILED";
      }

      // 🔧 FIX: Always reload the latest status from DB before writing.
      // Webhook may have updated the record already.
      const existing = await prisma.idempotencyKey.findUnique({
        where: { id: record.id },
      });

      // 🔧 IMPORTANT: Webhook priority check
      if (
        !existing ||
        ["FAILED", "CANCELLED", "COMPLETED"].includes(existing.status)
      ) {
        console.log(
          "[Idempotency] Status already finalized or missing, skipping update.",
        );
        return originalJson(body);
      }

      // 🔧 FIX: Conditional ID update to prevent null overwrites
      const updateData = {
        status: finalStatus,
        responseStatusCode: statusCode,
        responseBody: body,
      };

      if (body?.data?.id) updateData.orderId = body.data.id;
      if (body?.data?.payments?.[0]?.id)
        updateData.paymentId = body.data.payments[0].id;

      await prisma.idempotencyKey.update({
        where: { id: record.id },
        data: updateData,
      });

      console.log("[Idempotency Finalized]", {
        recordId: record.id,
        status: finalStatus,
      });
    } catch (err) {
      console.error("Idempotency finalize error:", err);
    }
    return originalJson(body);
  };
  next();
};
