const cron = require("node-cron");
const prisma = require("../config/prismaClient");

// Run every 1 minute - BOTH cleanups together
cron.schedule("* * * * *", async () => {
  console.log("======================================");
  console.log("Idempotency Cleanup Cron Started");
  console.log("Time:", new Date().toISOString());

  try {
    const now = new Date();
    
    // 2 minutes ago for COMPLETED payments
    const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);
    console.log(" Checking COMPLETED records created before:", twoMinutesAgo);
    
    // 50 minutes ago for IN_PROGRESS records
    const fiftyMinutesAgo = new Date(now.getTime() - 50 * 60 * 1000);
    console.log(" Checking IN_PROGRESS records created before:", fiftyMinutesAgo);

    // Delete COMPLETED records after 2 minutes
    const completedResult = await prisma.idempotencyKey.deleteMany({
      where: {
        status: "COMPLETED",
        createdAt: {
          lt: twoMinutesAgo,
        },
      },
    });

    console.log(`🗑 Deleted COMPLETED records: ${completedResult.count}`);

    // Delete IN_PROGRESS records after 50 minutes
    const otherResult = await prisma.idempotencyKey.deleteMany({
      where: {
        status: "IN_PROGRESS",  // Only valid enum value
        createdAt: {
          lt: fiftyMinutesAgo,
        },
      },
    });

    console.log(`🗑 Deleted IN_PROGRESS records: ${otherResult.count}`);
    console.log("Idempotency cleanup completed successfully");

  } catch (error) {
    console.error(" Error in Idempotency Cleanup Cron:", error);
  }

  console.log("======================================\n");
});

console.log("✅ Idempotency Cleanup Cron Loaded:");
console.log("   - Every 1 minute: Delete COMPLETED records (older than 2 minutes)");
console.log("   - Every 1 minute: Delete IN_PROGRESS records (older than 50 minutes)");