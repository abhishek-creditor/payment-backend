const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const prisma = require("./config/prismaClient");
// const auditLogger = require("./middleware/auditLogger");
const adminOnly = require("./middleware/admin.middleware");
const productWebhookRoutes = require("./routes/productWebhook.routes");
const subscriptionRoutes = require("./routes/subscription.routes");

const app = express();

// Middleware
app.use(helmet());
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
const corsLinks = {
  origin: ["http://localhost:3000","http://localhost:5173", "http://localhost:9000", "http://localhost:5000","http://52.45.128.241", "https://payment-config.netlify.app", "https://product-plans-data.netlify.app", "https://athena-product-plans.netlify.app", "https://payment-checkoutt.netlify.app", "https://ebook-backend-deploy.onrender.com", "https://creditor-backend-hg94.onrender.com", "https://athenabillings.com"],
  
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],

  allowedHeaders: ["Content-Type", "Authorization", "x-api-key", "Idempotency-Key"],
};
app.use(cors(corsLinks));
app.use(morgan("combined"));
// app.use(auditLogger); // Log all incoming requests for auditing

// Import routes
const paymentsRoutes = require("./routes/payments.routes");
const apiKeyRoutes = require("./routes/apiKey.routes");
const productsRoutes = require("./routes/products.routes");
const productPlanRoutes = require("./routes/productPlan.routes");
const crudOperationRoutes = require("./routes/CRUD.routes");
const adminIdempotencyRoutes = require("./routes/admin.idempotency.routes");

// use middleware for admin routes
app.use("/admin/idempotency", adminOnly, adminIdempotencyRoutes);

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
// ADMIN ROUTES (for managing products & API keys)
// ============================================
// TODO: Add admin authentication middleware here in production
// Example: app.use("/api/keys", adminAuth, apiKeyRoutes);
// For now, these routes are unprotected - SECURE THESE IN PRODUCTION!
app.use("/api/products", productsRoutes);
app.use("/api/keys", apiKeyRoutes);
app.use("/api/crud",crudOperationRoutes);
app.use("/api/product-plan", productPlanRoutes);
// admin crud routes for webhooks - for creating, updating, deleting webhook configs for different products/events
app.use("/admin/webhooks", productWebhookRoutes);

// Webhook routes - require raw body but NO API key
app.use("/api/webhooks", require("./routes/webhook.routes"));

// ============================================
// PROTECTED API ROUTES (require API key)
// ============================================
// Payment routes - require API key authentication
app.use("/api/payments", authenticate, paymentsRoutes);
app.use("/api/subscriptions", authenticate, subscriptionRoutes);

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