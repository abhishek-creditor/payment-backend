const cron = require("node-cron");
const prisma = require("../config/prismaClient");

// Run every 1 minute
cron.schedule("* * * * *", async () => {
  console.log("======================================");
  console.log("Idempotency Cleanup Cron Started");
  console.log("Time:", new Date().toISOString());

  try {
    // expiresAt already = createdAt + 50 minutes
    const now = new Date();
    console.log(" Checking records with expiresAt before:", now);

    // Count records before deleting
    const count = await prisma.idempotencyKey.count({
      where: {
        expiresAt: {
          lt: now,
        },
      },
    });

    console.log(` Records found for deletion: ${count}`);

    // Delete records
    const result = await prisma.idempotencyKey.deleteMany({
      where: {
        expiresAt: {
          lt: now,
        },
      },
    });

    console.log(`🗑 Deleted records: ${result.count}`);
    console.log("Idempotency cleanup completed successfully");

  } catch (error) {
    console.error(" Error in Idempotency Cleanup Cron:", error);
  }

  console.log("======================================\n");
});