const path = require("path");
const envFile = process.env.NODE_ENV === "production" ? ".env.production" : ".env.development";
require("dotenv").config({ path: path.resolve(__dirname, "../", envFile) });
require("./Cron/idempotencyCron"); 

const prisma = require("./config/prismaClient");
const app = require("./app");
// Database connectivity check on startup
async function checkDatabaseConnection() {
  try {
    console.log("Checking database connection...");
    await prisma.$queryRaw`SELECT 1`;
    console.log("✓ Database connection successful");
    return true;
  } catch (error) {
    console.error("✗ Database connection failed:", error.message);
    console.error("Please check your DATABASE_URL and ensure the database is accessible.");
    return false;
  }
}

// Start server only after database connection is verified
const PORT = process.env.PORT || 3000;

async function startServer() {
  const dbConnected = await checkDatabaseConnection();

  if (!dbConnected) {
    console.error("Failed to connect to database. Server will not start.");
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`Payment service running on port: http://localhost:${PORT}`);
  });
}

// Handle graceful shutdown
process.on("SIGTERM", async () => {
  console.log("SIGTERM signal received: closing HTTP server");
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("SIGINT signal received: closing HTTP server");
  await prisma.$disconnect();
  process.exit(0);
});

startServer();