/**
 * Admin Middleware (Internal Dashboard Access)
 * Only internal team can access using secret header
 */

function adminOnly(req, res, next) {
  try {
    const adminSecret = req.header("x-admin-secret");

    if (!adminSecret) {
      return res.status(401).json({
        success: false,
        message: "Admin secret key is missing"
      });
    }

    if (adminSecret !== process.env.ADMIN_SECRET) {
      return res.status(403).json({
        success: false,
        message: "Invalid admin secret key"
      });
    }

    next();

  } catch (error) {
    console.error("Admin middleware error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
}

module.exports = adminOnly;