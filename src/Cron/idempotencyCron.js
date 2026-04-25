const cron = require("node-cron");
const prisma = require("../config/prismaClient");
const rateLimitTrackerDao = require("../dao/rateLimitTracker.dao");

// Run every 1 minute
cron.schedule("* * * * *", async () => {
  console.log("======================================");
  console.log("Idempotency Cleanup Cron Started");
  console.log("Time:", new Date().toISOString());

  try {
    const now = new Date();
    
    const ttlSeconds = parseInt(process.env.IDEMPOTENCY_TTL_SECONDS) || 3000;
    const ttlAgo = new Date(now.getTime() - ttlSeconds * 1000);
    console.log(" Checking COMPLETED records created before:", ttlAgo);
    
    const inProgressTimeoutSeconds = parseInt(process.env.IDEMPOTENCY_IN_PROGRESS_TIMEOUT) || 60;
    const timeoutAgo = new Date(now.getTime() - inProgressTimeoutSeconds * 1000);
    console.log(" Checking IN_PROGRESS records created before:", timeoutAgo);

    const completedResult = await prisma.idempotencyKey.deleteMany({
      where: {
        status: "COMPLETED",
        createdAt: {
          lt: ttlAgo,
        },
      },
    });

    console.log(`🗑 Deleted COMPLETED records: ${completedResult.count}`);

    const otherResult = await prisma.idempotencyKey.deleteMany({
      where: {
        status: "IN_PROGRESS",  
        createdAt: {
          lt: timeoutAgo,
        },
      },
    });

    console.log(`🗑 Deleted IN_PROGRESS records: ${otherResult.count}`);

    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const deletedTrackers = await rateLimitTrackerDao.deleteOldTrackers(null, oneHourAgo);
    console.log(`🗑 Deleted old RateLimitTrackers: ${deletedTrackers.count}`);

    console.log("Idempotency cleanup completed successfully");

  } catch (error) {
    console.error(" Error in Idempotency Cleanup Cron:", error);
  }

  console.log("======================================\n");
});

