# API Key Management System

A secure, production-ready API key authentication and management system for multi-tenant payment gateway.

## 🔑 Features

- **Secure Key Generation**: Cryptographically secure random keys with bcrypt hashing
- **Multi-Product Support**: Manage keys for multiple products (LMS, eBook, PPT, etc.)
- **Environment-based Keys**: Separate keys for production, staging, and development
- **Permission System**: Granular permissions (charge, refund, read, write)
- **Rate Limiting**: Per-key rate limiting with sliding window
- **Key Lifecycle**: Generate, regenerate, update, deactivate, and delete keys
- **Usage Analytics**: Track key usage, success rates, and recent requests
- **Automatic Cleanup**: Scheduled cleanup of old rate limit trackers

## 📦 Installation

```bash
# Install dependencies
npm install bcryptjs express prisma @prisma/client

# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate dev
```

## 🏗️ Architecture

### Database Schema
- `ApiKey`: Stores API keys (hashed), permissions, and settings
- `RateLimitTracker`: Tracks request counts per minute window
- `ApiRequestLog`: Logs all API requests for auditing
- `Product`: Products that use the API

### Key Components

1. **Authentication Middleware** (`auth.js`)
   - Validates API keys
   - Checks rate limits
   - Updates usage statistics

2. **API Key Service** (`apiKey.service.js`)
   - Business logic for key management
   - CRUD operations
   - Analytics and statistics

3. **API Key Controller** (`apiKey.controller.js`)
   - HTTP endpoints for key management

4. **Permission Middleware** (`requirePermissions.js`)
   - Validates API key permissions

## 🚀 Usage

### 1. Generate an API Key

```javascript
POST /api/keys
Content-Type: application/json

{
  "productId": "uuid-of-product",
  "keyName": "Production Key",
  "environment": "production",
  "permissions": ["charge", "refund", "read"],
  "rateLimitPerMin": 100,
  "expiresInDays": 365
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "apiKey": "pk_prod_lms_a1b2c3d4e5f6...",
    "keyName": "Production Key",
    ...
  },
  "warning": "⚠️ Save this API key securely. It won't be shown again!"
}
```

### 2. Use the API Key

```javascript
POST /api/payments/charge
x-api-key: pk_prod_lms_a1b2c3d4e5f6...
Content-Type: application/json

{
  "amount": 5000,
  "currency": "USD"
}
```

### 3. List All Keys

```javascript
GET /api/keys?productId=uuid-of-product
```

### 4. Update Key Settings

```javascript
PATCH /api/keys/:keyId
Content-Type: application/json

{
  "keyName": "Updated Name",
  "rateLimitPerMin": 200,
  "permissions": ["charge", "refund", "read", "write"]
}
```

### 5. Regenerate Key

```javascript
POST /api/keys/:keyId/regenerate
```

### 6. Get Usage Statistics

```javascript
GET /api/keys/:keyId/stats?days=30
```

## 🔒 Security Best Practices

### Key Storage
- ✅ **DO**: Store keys in environment variables or secure vaults
- ✅ **DO**: Use different keys for different environments
- ❌ **DON'T**: Commit keys to version control
- ❌ **DON'T**: Share keys via email or chat

### Key Rotation
- Rotate keys every 90-365 days
- Immediately regenerate if compromised
- Keep old keys active briefly during rotation

### Permissions
- Use principle of least privilege
- Grant only necessary permissions
- Review permissions regularly

### Rate Limiting
- Set appropriate limits based on usage patterns
- Monitor for unusual spikes
- Adjust limits as needed

## 📊 Monitoring & Analytics

### Key Usage Metrics
```javascript
const stats = await apiKeyService.getApiKeyStats(keyId, 30);

// Returns:
// - totalRequests: Number of requests in period
// - successRate: Percentage of successful requests
// - recentRequests: Last 10 requests with details
```

### Request Logging
All API requests are logged in `ApiRequestLog`:
- Endpoint and method
- Status code
- Response time
- Error messages
- IP address and user agent

## 🛠️ Configuration

### Environment Variables
```bash
DATABASE_URL="postgresql://user:pass@localhost:5432/dbname"
PORT=3000
NODE_ENV=production
```

### Default Settings
- Rate limit: 100 requests/minute
- Environment: production
- Permissions: ["read"]
- Expiration: Never (unless specified)

## 🔄 Maintenance Tasks

### Cleanup Old Rate Limiters
```javascript
// Run every hour via cron
const cron = require('node-cron');

cron.schedule('0 * * * *', async () => {
  await apiKeyService.cleanupOldRateLimits();
});
```

### Archive Old Logs
```sql
-- Delete logs older than 90 days
DELETE FROM "ApiRequestLog"
WHERE "createdAt" < NOW() - INTERVAL '90 days';
```

## 📝 API Key Format

```
pk_prod_lms_a1b2c3d4e5f6789...
│  │    │   └─ Random 64-char hex (secret)
│  │    └───── Product code (lms, ebook, ppt)
│  └────────── Environment (prod, stag, deve)
└───────────── Prefix identifier
```

## 🚨 Error Responses

| Status | Error | Reason |
|--------|-------|--------|
| 401 | Missing API key | No `x-api-key` header |
| 403 | Invalid API key | Key not found or inactive |
| 403 | API key expired | Key past expiration date |
| 403 | Insufficient permissions | Key lacks required permission |
| 429 | Rate limit exceeded | Too many requests |

## 🧪 Testing

### Test Rate Limiting
```bash
# Send 101 requests quickly
for i in {1..101}; do
  curl -H "x-api-key: YOUR_KEY" http://localhost:3000/api/payments
done
# Request 101 should return 429
```

### Test Invalid Key
```bash
curl -H "x-api-key: invalid_key" http://localhost:3000/api/payments
# Should return 403
```

### Test Permissions
```bash
# Key with only "read" permission trying to charge
curl -X POST -H "x-api-key: READ_ONLY_KEY" \
  http://localhost:3000/api/payments/charge
# Should return 403 Insufficient permissions
```
