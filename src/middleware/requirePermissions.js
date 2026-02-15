/**
 * Middleware to check if the authenticated API key has required permissions
 * Use this after the authenticate middleware
 * 
 * @param {string[]} requiredPermissions - Array of required permissions
 * @returns {Function} Express middleware
 * 
 * @example
 * router.post('/charge', authenticate, requirePermissions(['charge']), controller.charge);
 */
function requirePermissions(requiredPermissions) {
  return (req, res, next) => {
    if (!req.apiKey) {
      return res.status(401).json({ 
        error: "Authentication required" 
      });
    }

    const apiKeyPermissions = req.apiKey.permissions || [];

    // Check if API key has all required permissions
    const hasAllPermissions = requiredPermissions.every(permission =>
      apiKeyPermissions.includes(permission)
    );

    if (!hasAllPermissions) {
      return res.status(403).json({
        error: "Insufficient permissions",
        required: requiredPermissions,
        available: apiKeyPermissions,
      });
    }

    next();
  };
}

module.exports = requirePermissions;