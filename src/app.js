const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const prisma = require("./utils/prisma");

const requestId = require("./middleware/requestId");
const requestLogger = require("./middleware/requestLogger");
const errorLogger = require("./middleware/errorLogger");

const app = express();

/* ======================================================
   GLOBAL MIDDLEWARE
====================================================== */

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan("combined"));

app.use(requestId);       // Unique request ID
app.use(requestLogger);   // 🔥 Log every request

/* ======================================================
   ROUTES
====================================================== */

const paymentsRoutes = require("./routes/payments.routes");
const apiKeyRoutes = require("./routes/apiKey.routes");
const productsRoutes = require("./routes/products.routes");

const authenticate = require("./middleware/auth");

/* ---------------- PUBLIC ROUTES ---------------- */

app.get("/", (req, res) => {
  res.send("Payment service is running");
});

app.get("/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    res.status(200).json({
      status: "ok",
      database: "connected",
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  } catch (error) {
    res.status(503).json({
      status: "error",
      database: "disconnected",
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/* ---------------- ADMIN ROUTES ---------------- */

app.use("/api/products", productsRoutes);
app.use("/api/keys", apiKeyRoutes);

/* ---------------- PROTECTED ROUTES ---------------- */

app.use("/api/payments", authenticate, paymentsRoutes);

/* ======================================================
   404 HANDLER
====================================================== */

app.use((req, res) => {
  res.status(404).json({
    error: "Route not found",
    path: req.path,
    method: req.method
  });
});

/* ======================================================
   GLOBAL ERROR HANDLER (Enterprise Safe)
====================================================== */

app.use(errorLogger);

module.exports = app;