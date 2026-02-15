const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const prisma = require("./utils/prisma");

const app = express();

// Middleware
app.use(helmet());
app.use(express.json());
app.use(cors()); // Allow all origins by default for now, or configure as needed
app.use(morgan("combined"));

// Import routes
const paymentsRoutes = require("./routes/payments.routes");
const apiKeyRoutes = require("./routes/apiKey.routes");

// Import middleware
const authenticate = require("./middleware/auth");

// ============================================
// PUBLIC ROUTES (no authentication)
// ============================================

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

// ============================================
// ADMIN ROUTES (for managing API keys)
// ============================================
// TODO: Add admin authentication middleware here in production
// Example: app.use("/api/keys", adminAuth, apiKeyRoutes);
// For now, these routes are unprotected - SECURE THESE IN PRODUCTION!
app.use("/api/keys", apiKeyRoutes);

// ============================================
// PROTECTED API ROUTES (require API key)
// ============================================
// Payment routes - require API key authentication
app.use("/api/payments", authenticate, paymentsRoutes);

// ============================================
// ERROR HANDLING
// ============================================

// 404 handler - must come after all routes
app.use((req, res) => {
  res.status(404).json({ 
    error: "Route not found",
    path: req.path,
    method: req.method
  });
});

// Global error handler - must be last
app.use((err, req, res, next) => {
  console.error("Error:", err);
  
  res.status(err.status || 500).json({
    error: err.message || "Internal server error",
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

module.exports = app;