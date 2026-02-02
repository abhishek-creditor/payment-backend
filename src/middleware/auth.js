const crypto = require("crypto");
const prisma = require("../utils/prisma");

module.exports = async function authenticate(req, res, next) {
  const apiKey = req.header("x-api-key");
  if (!apiKey) return res.status(401).json({ error: "Missing API key" });

  const hash = crypto.createHash("sha256").update(apiKey).digest("hex");

  const key = await prisma.apiKey.findFirst({
    where: { keyHash: hash, isActive: true }
  });

  if (!key) return res.status(403).json({ error: "Invalid API key" });

  req.tenantId = key.tenantId;
  next();
};
