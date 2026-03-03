const prisma = require("../config/prismaClient");

/**
 * Get all idempotency keys (full data)
 */
async function getAllKeys() {
  return prisma.idempotencyKey.findMany({
    orderBy: { createdAt: "desc" }
  });
}

/**
 * Get summary (id + key + status only)
 */
async function getKeySummary() {
  return prisma.idempotencyKey.findMany({
    select: {
      id: true,
      key: true,
      status: true,
      expiresAt: true,
      createdAt: true
    },
    orderBy: { createdAt: "desc" }
  });
}

/**
 * Get single key by ID
 */
async function getById(id) {
  return prisma.idempotencyKey.findUnique({
    where: { id }
  });
}

/**
 * Update allowed fields only
 */
async function updateKey(id, data) {
  // Pehle check karo record exist karta hai ya nahi
  const existing = await prisma.idempotencyKey.findUnique({
    where: { id }
  });

  if (!existing) {
    throw new Error("Idempotency key not found");
  }

  // Ye fields kabhi update nahi honi chahiye
//   const blockedFields = ["id", "productId", "createdAt", "updatedAt"];
//   const blockedFields = ["id", "productId", "createdAt"];
  const blockedFields = ["id", "productId"];

  const updateData = {};

  // Jo bhi body me bheja gaya hai, agar blocked nahi hai to allow karo
  for (const field in data) {
    if (!blockedFields.includes(field)) {
      updateData[field] = data[field];
    }
  }

  if (Object.keys(updateData).length === 0) {
    throw new Error("No valid fields provided for update");
  }

  return prisma.idempotencyKey.update({
    where: { id },
    data: updateData
  }); 
}
/**
 * Delete by ID (with optional force flag)
 */
async function deleteById(id, force = false) {
  const existing = await prisma.idempotencyKey.findUnique({
    where: { id }
  });

  if (!existing) {
    throw new Error("Idempotency key not found");
  }

  if (
    existing.status === "IN_PROGRESS" &&
    existing.expiresAt > new Date() &&
    !force
  ) {
    throw new Error(
      "Cannot delete active IN_PROGRESS key. Use force=true if required."
    );
  }

  return prisma.idempotencyKey.delete({
    where: { id }
  });
}

/**
 * Delete many expired IN_PROGRESS keys
 * (Phase 2 cron job reuse)
 */
async function deleteExpiredInProgress() {
  return prisma.idempotencyKey.deleteMany({
    where: {
      status: "IN_PROGRESS",
      expiresAt: {
        lt: new Date()
      }
    }
  });
}

module.exports = {
  getAllKeys,
  getKeySummary,
  getById,
  updateKey,
  deleteById,
  deleteExpiredInProgress
};