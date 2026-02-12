// ============================================
// API KEY MANAGEMENT - USAGE EXAMPLES
// ============================================

// Required package.json dependencies:
// npm install bcryptjs express prisma @prisma/client

// ============================================
// 1. GENERATE A NEW API KEY
// ============================================

/*
POST /api/keys
Content-Type: application/json

{
  "productId": "123e4567-e89b-12d3-a456-426614174000",
  "keyName": "Production Key - Main",
  "environment": "production",
  "permissions": ["charge", "refund", "read"],
  "rateLimitPerMin": 100,
  "expiresInDays": 365
}

Response:
{
  "success": true,
  "data": {
    "id": "key-id-here",
    "apiKey": "pk_prod_lms_a1b2c3d4e5f6...",  // ⚠️ SAVE THIS!
    "keyName": "Production Key - Main",
    "keyPrefix": "pk_prod_lms_",
    "environment": "production",
    "permissions": ["charge", "refund", "read"],
    "rateLimitPerMin": 100,
    "expiresAt": "2026-02-12T00:00:00.000Z",
    "createdAt": "2025-02-12T00:00:00.000Z",
    "product": {
      "id": "...",
      "name": "LMS Platform",
      "code": "lms"
    }
  },
  "warning": "⚠️ Save this API key securely. It won't be shown again!"
}
*/

// ============================================
// 2. LIST ALL API KEYS FOR A PRODUCT
// ============================================

/*
GET /api/keys?productId=123e4567-e89b-12d3-a456-426614174000

Response:
{
  "success": true,
  "data": [
    {
      "id": "key-1",
      "keyName": "Production Key - Main",
      "keyPrefix": "pk_prod_lms_",
      "environment": "production",
      "permissions": ["charge", "refund", "read"],
      "rateLimitPerMin": 100,
      "isActive": true,
      "expiresAt": "2026-02-12T00:00:00.000Z",
      "lastUsedAt": "2025-02-11T15:30:00.000Z",
      "createdAt": "2025-02-12T00:00:00.000Z",
      "product": { ... }
    },
    ...
  ]
}
*/

// ============================================
// 3. GET SPECIFIC API KEY DETAILS
// ============================================

/*
GET /api/keys/key-id-here

Response:
{
  "success": true,
  "data": {
    "id": "key-id-here",
    "keyName": "Production Key - Main",
    "keyPrefix": "pk_prod_lms_",
    "environment": "production",
    "permissions": ["charge", "refund", "read"],
    "rateLimitPerMin": 100,
    "isActive": true,
    "expiresAt": "2026-02-12T00:00:00.000Z",
    "lastUsedAt": "2025-02-11T15:30:00.000Z",
    "createdAt": "2025-02-12T00:00:00.000Z",
    "updatedAt": "2025-02-12T00:00:00.000Z",
    "product": { ... }
  }
}
*/

// ============================================
// 4. UPDATE API KEY SETTINGS
// ============================================

/*
PATCH /api/keys/key-id-here
Content-Type: application/json

{
  "keyName": "Production Key - Updated Name",
  "rateLimitPerMin": 200,
  "permissions": ["charge", "refund", "read", "write"]
}

Response: Updated key details
*/

// ============================================
// 5. REGENERATE API KEY
// ============================================

/*
POST /api/keys/key-id-here/regenerate

Response:
{
  "success": true,
  "data": {
    "id": "key-id-here",
    "apiKey": "pk_prod_lms_NEW_KEY_HERE",  // ⚠️ NEW KEY!
    "keyName": "Production Key - Main",
    ...
  },
  "warning": "⚠️ Save this new API key securely. It won't be shown again!"
}
*/

// ============================================
// 6. DEACTIVATE API KEY (SOFT DELETE)
// ============================================

/*
POST /api/keys/key-id-here/deactivate

Response:
{
  "success": true,
  "data": {
    "id": "key-id-here",
    "keyName": "Production Key - Main",
    "isActive": false
  }
}
*/

// ============================================
// 7. PERMANENTLY DELETE API KEY
// ============================================

/*
DELETE /api/keys/key-id-here

Response:
{
  "success": true,
  "data": {
    "success": true,
    "message": "API key deleted successfully"
  }
}
*/

// ============================================
// 8. GET API KEY USAGE STATISTICS
// ============================================

/*
GET /api/keys/key-id-here/stats?days=30

Response:
{
  "success": true,
  "data": {
    "totalRequests": 1542,
    "successRate": "98.50",
    "period": "Last 30 days",
    "recentRequests": [
      {
        "statusCode": 200,
        "createdAt": "2025-02-11T15:30:00.000Z",
        "endpoint": "/api/payments/charge"
      },
      ...
    ]
  }
}
*/

// ============================================
// 9. USING THE API KEY IN REQUESTS
// ============================================

/*
POST /api/payments/charge
x-api-key: pk_prod_lms_a1b2c3d4e5f6...
Content-Type: application/json

{
  "amount": 5000,
  "currency": "USD",
  ...
}

Success: 200 OK
Rate limited: 429 Too Many Requests
Invalid key: 403 Forbidden
Expired key: 403 Forbidden
Missing key: 401 Unauthorized
*/

// ============================================
// 10. TESTING WITH CURL
// ============================================

/*
# Generate API key
curl -X POST http://localhost:3000/api/keys \
  -H "Content-Type: application/json" \
  -d '{
    "productId": "123e4567-e89b-12d3-a456-426614174000",
    "keyName": "Test Key",
    "environment": "development",
    "permissions": ["read"]
  }'

# Use API key
curl -X GET http://localhost:3000/api/payments \
  -H "x-api-key: pk_deve_lms_YOUR_KEY_HERE"

# Check rate limiting (send 101 requests in a minute)
for i in {1..101}; do
  curl -X GET http://localhost:3000/api/payments \
    -H "x-api-key: pk_deve_lms_YOUR_KEY_HERE"
done
# Should get 429 on the 101st request

# Get key stats
curl http://localhost:3000/api/keys/key-id-here/stats?days=7
*/

// ============================================
// 11. PROGRAMMATIC USAGE
// ============================================

const apiKeyService = require('./services/apiKey.service');

// Generate a key
async function createKey() {
  try {
    const result = await apiKeyService.generateApiKey({
      productId: '123e4567-e89b-12d3-a456-426614174000',
      keyName: 'My API Key',
      environment: 'production',
      permissions: ['charge', 'read'],
      rateLimitPerMin: 50,
      expiresInDays: 90
    });
    
    console.log('API Key created:', result.apiKey);
    // Store this key securely - it won't be shown again!
  } catch (error) {
    console.error('Error:', error.message);
  }
}

// List keys
async function listKeys() {
  const keys = await apiKeyService.listApiKeys('product-id-here');
  console.log('Keys:', keys);
}

// Update key
async function updateKey() {
  const updated = await apiKeyService.updateApiKey('key-id-here', {
    rateLimitPerMin: 200,
    permissions: ['charge', 'refund', 'read']
  });
  console.log('Updated:', updated);
}

// ============================================
// 12. CRON JOB FOR CLEANUP
// ============================================

/*
// Add this to your cron jobs or scheduled tasks
// Run every hour to clean up old rate limit trackers

const cron = require('node-cron');
const apiKeyService = require('./services/apiKey.service');

// Run cleanup every hour
cron.schedule('0 * * * *', async () => {
  console.log('Running rate limit cleanup...');
  const result = await apiKeyService.cleanupOldRateLimits();
  console.log(result.message);
});
*/

// ============================================
// 13. BEST PRACTICES
// ============================================

/*
1. NEVER log or store API keys in plain text
2. ALWAYS show the key only once during generation
3. Use different keys for different environments
4. Set appropriate expiration dates
5. Use the principle of least privilege for permissions
6. Monitor API key usage regularly
7. Rotate keys periodically
8. Deactivate keys immediately if compromised
9. Set reasonable rate limits
10. Log all API key usage for audit trails

Key Format Explanation:
pk_prod_lms_a1b2c3d4e5f6...
│  │    │   └─ Random 64-char hex string
│  │    └───── Product code
│  └────────── Environment (prod/stag/deve)
└───────────── Prefix (pk = payment key)
*/

module.exports = {
  // Export for testing
  examples: 'See comments above'
};