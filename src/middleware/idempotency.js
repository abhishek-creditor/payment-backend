const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

module.exports = async function idempotency(req, res, next) {
  const key = req.header("Idempotency-Key");
  if (!key) return next();

  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify(req.body))
    .digest("hex");

  const existing = await prisma.idempotencyKey.findFirst({
    where: { tenantId: req.tenantId, key }
  });

  if (existing) {
    return res.json(existing.responseBody);
  }

  res.sendResponse = res.json;
  res.json = async (body) => {
    await prisma.idempotencyKey.create({
      data: {
        tenantId: req.tenantId,
        key,
        requestHash: hash,
        responseBody: body
      }
    });
    res.sendResponse(body);
  };

  next();
};
