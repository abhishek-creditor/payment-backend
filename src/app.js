const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const prisma = require("./utils/prisma");

const app = express();

app.use(helmet());
app.use(express.json());
app.use(cors()); // Allow all origins by default for now, or configure as needed
app.use(morgan("combined"));

app.get("/", (req, res) => {
  res.send("Payment service is running");
});

// Health check endpoint
app.get("/health", async (req, res) => {
  try {
    // Check database connection
    await prisma.$queryRaw`SELECT 1`;
    
    res.status(200).json({ 
      status: 'ok', 
      database: 'connected',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  } catch (error) {
    res.status(503).json({ 
      status: 'error', 
      database: 'disconnected',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = app;
