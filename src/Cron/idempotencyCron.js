const cron = require("node-cron");
const prisma = require("../config/prismaClient");

// Run every 1 minute
cron.schedule("* * * * *", async () => {
  console.log("======================================");
  console.log("Idempotency Cleanup Cron Started");
  console.log("Time:", new Date().toISOString());

  try {
    const now = new Date();
    
    const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);
    console.log(" Checking COMPLETED records created before:", twoMinutesAgo);
    
    const fiftyMinutesAgo = new Date(now.getTime() - 50 * 60 * 1000);
    console.log(" Checking IN_PROGRESS records created before:", fiftyMinutesAgo);

    const completedResult = await prisma.idempotencyKey.deleteMany({
      where: {
        status: "COMPLETED",
        createdAt: {
          lt: twoMinutesAgo,
        },
      },
    });

    console.log(`🗑 Deleted COMPLETED records: ${completedResult.count}`);

    const otherResult = await prisma.idempotencyKey.deleteMany({
      where: {
        status: "IN_PROGRESS",  
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

