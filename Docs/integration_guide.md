# Payment Microservice — Integration Guide

> **Audience:** Engineering teams (eBook stores, LMS platforms, online presentation tools, and similar) integrating their backends with this Payment Microservice as a payment gateway abstraction layer.
>
> **Derived from:** Full static analysis of source code — routes, controllers, middleware, services, DAOs, and Prisma schema. Every claim in this document is traceable to actual code.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Authentication](#2-authentication)
3. [Initiating Payments (Outbound API)](#3-initiating-payments-outbound-api)
4. [Receiving Payment Events (Inbound Webhooks to Your Service)](#4-receiving-payment-events-inbound-webhooks-to-your-service)
5. [End-to-End Payment Flow](#5-end-to-end-payment-flow)
6. [Error Reference](#6-error-reference)
7. [Integration Checklist](#7-integration-checklist)
8. [Known Gaps & Work In Progress](#8-known-gaps--work-in-progress)

---

## 1. Overview

This Payment Microservice is a **centralized, multi-tenant payment gateway abstraction layer** built on top of [Tilled](https://tilled.com). It handles:

- **Checkout session creation** — Redirects end users to a hosted Tilled checkout page.
- **Order & payment lifecycle management** — Tracks `Order` and [Payment](file:///home/anil/Desktop/payment-backend/src/controllers/payments.controller.js#43-68) state changes across their full lifecycle.
- **Inbound webhook processing** — Receives Tilled webhook events and updates internal order/payment state accordingly.
- **Outgoing callback dispatch** *(schema exists; dispatcher is a WIP — see §8)* — Notifies your backend when payment status changes.
- **Idempotency** — Prevents duplicate charges on network retries.
- **Multi-product tenancy** — Isolated by `productId`; different products (LMS, eBook, PPT) each have their own API keys, plans, and orders.

**Payment flow summary:**
Your backend calls this service → Service creates a Tilled checkout session → Returns a `checkoutUrl` → User pays on Tilled-hosted page → Tilled sends a webhook to this service → This service updates order status → Your backend receives an outgoing callback (when dispatcher is live).

---

## 2. Authentication

### 2.1 API Key Authentication

All payment API routes (`/api/payments/*`) require an API key passed as an HTTP header.

| Header | Value |
|--------|-------|
| `x-api-key` | Your product's API key (e.g., `pk_prod_lms_<64-hex-chars>`) |

**Key format:** `pk_<env>_<product-code>_<64-hex-chars>`

Examples:
- `pk_prod_lms_a3f1...` — Production key for an LMS product
- `pk_sand_eboo_c9d2...` — Sandbox key for an eBook product

**Key lookup is prefix-based + bcrypt comparison.** The prefix (`pk_prod_lms_`) is stored in plaintext; the full key is bcrypt-hashed. The service extracts the prefix, fetches matching keys, then bcrypt-compares the full key. **Store your API key at generation time — it is never shown again.**

**Key validation checks (in order):**
1. Header present → `401` if missing
2. Prefix matches an active key in DB → `403` if no match
3. Full key bcrypt matches stored hash → `403` if mismatch
4. Key not expired (`expiresAt` check) → `403` if expired
5. Rate limit not exceeded → `429` if exceeded

### 2.2 Permissions

Each API key carries a `permissions` array. Routes enforce specific permissions:

| Permission | Grants access to |
|-----------|-----------------|
| `charge` | `POST /api/payments` |
| [refund](file:///home/anil/Desktop/payment-backend/src/controllers/payments.controller.js#106-145) | `POST /api/payments/:id/refund` |
| `read` | `GET /api/payments`, `GET /api/payments/:id` |

A key can hold multiple permissions, e.g. `["charge", "refund", "read"]`.

If the required permission is absent, the response is:
```json
{
  "error": "Insufficient permissions",
  "required": ["charge"],
  "available": ["read"]
}
```

### 2.3 Rate Limiting

Rate limiting is enforced per API key per minute. The limit is configurable per key (`rateLimitPerMin`, default `100`).

When exceeded, the response is `HTTP 429` with headers:

| Header | Meaning |
|--------|---------|
| `Retry-After` | Seconds until the window resets |
| `X-RateLimit-Limit` | Total allowed requests per minute |
| `X-RateLimit-Remaining` | Requests remaining in current window |

### 2.4 Admin Routes

Certain management routes (`/admin/idempotency/*`) require an additional header:

| Header | Value |
|--------|-------|
| `x-admin-secret` | Value of `ADMIN_SECRET` env variable (internal only) |

> **Note:** `/api/products`, `/api/keys`, `/api/product-plan`, `/api/crud`, and `/admin/webhooks` are **not currently protected** by API key or admin auth middleware. See §8.

---

## 3. Initiating Payments (Outbound API)

Base URL: `https://<your-payment-service-host>`

All protected routes require the `x-api-key` header.

---

### 3.1 Create Payment (Initiate Checkout)

Creates a new order and a Tilled-hosted checkout session. Returns a `checkoutUrl` for the user to complete payment.

```
POST /api/payments
```

**Required Headers:**

| Header | Value |
|--------|-------|
| `x-api-key` | Your API key with `charge` permission |
| `Content-Type` | `application/json` |
| `Idempotency-Key` | *(Optional but strongly recommended)* A unique string per transaction |

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `externalUserId` OR `productUserId` | `string` | ✅ One required | Your internal user ID (stored as `ProductUser.externalUserId`) |
| `name` OR `user_name` | `string` | ✅ One required | User's display name. Max 100 chars |
| `email` OR `user_email` | `string` | ✅ One required | User's email address. Must be a valid email format |
| `referenceId` | `string` | ✅ Required | **Your order/entity ID** (e.g., your DB order ID). Used to detect duplicate charges. Must be unique per product |
| `productPlanId` | `string` | ✅ Required | UUID of the product plan (pricing plan) to charge for |
| `paymentMethod` | `string` | ❌ Optional | Default: `"CARD"`. Enum: `CARD`, `ACH`, `WALLET` |
| `tilledAccountId` OR `account_id` | `string` | ❌ Optional | Override Tilled account ID. Defaults to `TILLED_SANDBOX_ACCOUNT_ID` |
| `platform_fee_amount` | `number` | ❌ Optional | Platform fee in smallest currency unit (cents) |
| `items` | `array` | ❌ Optional | Line items array. Falls back to `extraData.items` if not present |
| `extraData` | `object` | ❌ Optional | Arbitrary metadata passed to Tilled (see below) |

**`extraData` fields recognized by the service:**

| Field | Stored as Tilled metadata |
|-------|--------------------------|
| `extraData.userTilledId` | Attempts to reuse existing Tilled customer |
| `extraData.bookId` / `extraData.purchased_id` | `entity_id` in Tilled metadata |
| `extraData.organisationId` | `organisation_id` in Tilled metadata |
| `extraData.authorId` | `author_id` in Tilled metadata |

**Example Request:**
```json
{
  "externalUserId": "usr_123abc",
  "name": "Jane Doe",
  "email": "jane@example.com",
  "referenceId": "order_456xyz",
  "productPlanId": "clm9x2k4f0001t2abc3def456",
  "paymentMethod": "CARD",
  "platform_fee_amount": 150,
  "extraData": {
    "bookId": "book_987"
  }
}
```

**Success Response — New Payment (`201 Created`):**
```json
{
  "success": true,
  "status": "PROCESSING",
  "duplicate": false,
  "checkoutUrl": "https://checkout.tilled.com/c/cs_live_...",
  "data": {
    "id": "<order-uuid>",
    "productId": "<product-uuid>",
    "productUserId": "<product-user-uuid>",
    "referenceId": "order_456xyz",
    "amount": 2999,
    "currency": "USD",
    "status": "CREATED",
    "payments": [
      {
        "id": "<payment-uuid>",
        "status": "PROCESSING",
        "method": "CARD",
        "amount": 2999
      }
    ],
    "duplicate": false,
    "checkoutUrl": "https://checkout.tilled.com/c/cs_live_..."
  }
}
```

**Success Response — Duplicate (Already Paid or In-Progress) (`200 OK`):**
```json
{
  "success": true,
  "status": "SUCCEEDED",
  "duplicate": true,
  "checkoutUrl": null,
  "data": { ... }
}
```

> **Duplicate detection logic:** If the same `referenceId` exists for your `productId` in the database:
> - If the latest payment is `SUCCEEDED` → Returns existing data, no new charge (`duplicate: true`)
> - If the latest payment is `INITIATED` or `PROCESSING` → Returns existing data (`duplicate: true`)
> - If the latest payment is `FAILED` or `CANCELLED` → Creates a new payment attempt (`duplicate: false`)

**Idempotency replay response (`200 OK`):**
Returned with `Idempotency-Replayed: true` header when the same `Idempotency-Key` is presented for an already-completed request.

---

### 3.2 Get All Payments

Returns all orders scoped to your product.

```
GET /api/payments
```

**Required Headers:** `x-api-key` (needs `read` permission)

**Query Parameters:** Forwarded directly to the order DAO (filtering/pagination details depend on DAO implementation).

**Success Response (`200 OK`):**
```json
{
  "success": true,
  "data": [ /* array of order objects */ ]
}
```

---

### 3.3 Get Payment by ID

Returns a single order with its items, payments, and user info.

```
GET /api/payments/:id
```

**Required Headers:** `x-api-key` (needs `read` permission)

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| [id](file:///home/anil/Desktop/payment-backend/src/middleware/validatePaymentRequest.js#3-18) | Payment order UUID |

**Success Response (`200 OK`):**
```json
{
  "success": true,
  "data": {
    "id": "<order-uuid>",
    "referenceId": "order_456xyz",
    "amount": 2999,
    "currency": "USD",
    "status": "PAID",
    "items": [ /* OrderItem[] */ ],
    "payments": [ /* Payment[] */ ],
    "productUser": { /* ProductUser */ }
  }
}
```

**Not Found Response (`404 Not Found`):**
```json
{
  "success": false,
  "message": "Payment not found"
}
```

---

### 3.4 Refund Payment

Initiates a refund for a previously succeeded payment.

```
POST /api/payments/:id/refund
```

**Required Headers:** `x-api-key` (needs [refund](file:///home/anil/Desktop/payment-backend/src/controllers/payments.controller.js#106-145) permission)

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| [id](file:///home/anil/Desktop/payment-backend/src/middleware/validatePaymentRequest.js#3-18) | Order UUID (not payment UUID) |

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `amount` | `number` | ✅ Required | Refund amount in smallest currency unit (cents). Must be > 0 and ≤ remaining refundable amount |
| `reason` | `string` | ❌ Optional | Human-readable reason for the refund |

**Example Request:**
```json
{
  "amount": 1000,
  "reason": "Customer requested cancellation"
}
```

**Success Response (`200 OK`):**
```json
{
  "success": true,
  "data": {
    "id": "<refund-uuid>",
    "paymentId": "<payment-uuid>",
    "amount": 1000,
    "reason": "Customer requested cancellation",
    "status": "SUCCEEDED",
    "tilledRefundId": "simulated_tilled_refund_id"
  }
}
```

> ⚠️ **WIP:** The actual Tilled API refund call is stubbed out. See §8.

---

### 3.5 Idempotency

For `POST /api/payments` and `POST /api/payments/:id/refund`, you **should** send an `Idempotency-Key` header.

| Header | Value |
|--------|-------|
| `Idempotency-Key` | A unique string per logical operation (e.g., UUID v4) |

**Behavior:**

| Scenario | Response |
|----------|----------|
| First request | Processes normally, `Idempotency-Replayed: false` |
| Retry of completed request (same key + same body) | Returns cached response, `Idempotency-Replayed: true`, `HTTP 200` |
| Same key with **different** body | `HTTP 409`, `"Idempotency-Key reused with different payload"` |
| Request still in progress | `HTTP 409`, `"Request is currently processing"` |
| Same key after `FAILED`/`CANCELLED` payment | Allows retry (record deleted) |

**TTL:** Idempotency records expire after 3000 seconds (50 minutes) for `FAILED`/`CANCELLED` states. `COMPLETED` records persist indefinitely until TTL.

---

## 4. Receiving Payment Events (Inbound Webhooks to Your Service)

### 4.1 Architecture Overview

This service does **not** call your backend directly in real-time today; instead, it has a `ProductWebhookConfig` model that stores outgoing webhook configurations. Delivery dispatch logic is currently unimplemented (see §8). Once implemented, the flow will be:

1. Tilled sends a webhook to `POST /api/webhooks/tilled` on **this service**.
2. This service validates the signature, updates its internal order/payment state.
3. This service sends a configured callback to **your** registered endpoint.

You must register your callback endpoint with the payment service team using the Admin Webhook Config API (§4.3).

### 4.2 Tilled Webhook Events Handled (Internal)

The following Tilled event types are fully handled in code. These translate to state changes in your orders/payments:

#### `payment_intent.succeeded`

| What happens | Details |
|-------------|---------|
| `Payment.status` → | `SUCCEEDED` |
| `Order.status` → | `PAID` |
| Trigger | User completed payment on Tilled checkout |

#### `payment_intent.payment_failed`

| What happens | Details |
|-------------|---------|
| `Payment.status` → | `FAILED` |
| `Order.status` → | `FAILED` |
| Trigger | Payment attempt declined/failed |

#### `payment_intent.canceled`

| What happens | Details |
|-------------|---------|
| `Payment.status` → | `CANCELLED` |
| `Order.status` → | `CANCELLED` |
| Trigger | Payment intent explicitly cancelled |

#### `customer.created` / `customer.updated`

Upserts a `ProductUser` record and links the Tilled `customer.id` to the internal user. Requires metadata fields `productId` and `externalUserId` to be present on the event.

#### `subscription.created`

Creates/upserts a [Subscription](file:///home/anil/Desktop/payment-backend/src/services/tilled.service.js#135-138) record. Requires `productId`, `productUserId`, and `planId` in the subscription's `metadata`.

#### `subscription.updated`

Updates subscription status and billing period dates by `tilledSubscriptionId`.

#### `subscription.canceled`

Sets subscription status to `CANCELLED` and records `cancelledAt` timestamp.

#### `charge.succeeded` / `charge.failed` / `charge.refunded`

**Logged only** — no internal state is mutated beyond the console log. See §8.

---

### 4.3 Registering Your Webhook Endpoint (Outgoing Config)

Use the Admin Webhook Config API to register the URL where this service will POST payment event notifications to your backend.

```
POST /admin/webhooks
```

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `productId` | `string` | ✅ Required | Your product UUID |
| `triggerEvent` | `string` | ✅ Required | Event that triggers this callback (e.g., `payment_intent.succeeded`) |
| `callbackUrl` | `string` | ✅ Required | Full URL of your endpoint (must be a valid URL) |
| `httpMethod` | `string` | ❌ Optional | Default: `POST`. Enum: `POST`, `PUT`, `PATCH`, `GET` |
| `authType` | `string` | ❌ Optional | Default: `BEARER_TOKEN`. Enum: `BEARER_TOKEN`, `API_KEY_HEADER`, `BASIC_AUTH`, `HMAC_SIGNATURE`, `NONE` |
| `authSecret` | `string` | ❌ Optional | Token/secret used for outgoing auth |
| `headers` | `object` | ❌ Optional | Additional HTTP headers to include |
| `bodyTemplate` | `object` | ❌ Optional | JSON template with `{{orderId}}`, `{{userId}}` etc. placeholders |
| `maxRetries` | `number` | ❌ Optional | Default: `3`. Must be ≥ 0 |
| `retryDelayMs` | `number` | ❌ Optional | Default: `1000`. Must be ≥ 0 |

**Success Response (`201 Created`):** Returns the created `ProductWebhookConfig` object.

---

### 4.4 What Your Endpoint Should Return

Until the delivery dispatcher is live, this is forward-looking. When your endpoint receives a callback:

- **Return `HTTP 2xx`** to acknowledge receipt.
- Any non-2xx response will be treated as a delivery failure and will trigger retries up to `maxRetries` times with `retryDelayMs` delay between attempts.

---

## 5. End-to-End Payment Flow

The following describes the exact flow as implemented in the code:

```
1. PRE-REQUISITE (Admin, one-time setup):
   - You (integration team) have been registered as a "Product" in the system
     with a product code (e.g., "lms", "ebook").
   - A ProductPlan has been created with a price, currency, and billing type.
   - An API key with required permissions has been generated and shared with you.
   - Your webhook callback URL has been registered (POST /admin/webhooks).

2. PAYMENT INITIATION (your backend → this service):
   - Your backend calls: POST /api/payments
     with x-api-key header, referenceId (your order ID), productPlanId, user info.
   - The service authenticates and validates the request.
   - Idempotency middleware checks for duplicate operations.

3. ORDER & PAYMENT CREATION (this service → DB):
   - The service checks if the referenceId already exists for your productId.
   - If new: Creates an Order (status=CREATED) and a Payment (status=INITIATED).
   - If retryable (FAILED/CANCELLED): Creates a new Payment on the existing Order.
   - If duplicate (SUCCEEDED / PROCESSING): Returns existing data immediately.

4. TILLED CUSTOMER RESOLUTION (this service → Tilled API):
   - Service checks if it has a Tilled customer ID for the user.
   - If none: Creates a new Tilled customer with the user's email and name.
   - Tilled customer ID is stored on the ProductUser record.

5. TILLED CHECKOUT SESSION CREATION (this service → Tilled API):
   - Service creates a Tilled Checkout Session with:
     * Line items derived from the ProductPlan (name, price, currency)
     * customer_id from step 4
     * success_url: https://payment-pagess.netlify.app/success
     * cancel_url: https://payment-pagess.netlify.app/cancelled
     * payment_intent_data: { payment_method_types: ["card"], setup_future_usage: "off_session" }
     * Metadata: order_id, user_id, plan_id, product_id, etc.
   - Payment record updated to PROCESSING with tilledPaymentId.

6. CHECKOUT URL RETURNED (this service → your backend):
   - Response: { success: true, status: "PROCESSING", checkoutUrl: "https://...", data: {...} }

7. USER PAYMENT (your frontend → Tilled hosted page):
   - Your frontend redirects the user to checkoutUrl.
   - User enters card details on the Tilled-hosted checkout page.
   - On success: User is redirected to the success_url.
   - On cancel: User is redirected to the cancel_url.

8. TILLED WEBHOOK (Tilled → this service):
   - Tilled sends POST /api/webhooks/tilled with event data.
   - Service verifies the tilled-signature header using HMAC SHA256.
   - Service saves the event to the WebhookEvent table.
   - For payment_intent.succeeded:
     * Payment.status → SUCCEEDED
     * Order.status → PAID
   - For payment_intent.payment_failed:
     * Payment.status → FAILED
     * Order.status → FAILED
   - For payment_intent.canceled:
     * Payment.status → CANCELLED
     * Order.status → CANCELLED

9. OUTGOING CALLBACK (this service → your backend) [PLANNED — NOT YET LIVE]:
   - This service dispatches a POST to your registered callbackUrl.
   - Payload will include order ID, payment status, and related metadata.
   - Retried up to maxRetries times on failure.

10. POLLING ALTERNATIVE (your backend → this service):
    - Until outgoing callbacks are live, you can poll:
      GET /api/payments/:orderId (requires x-api-key with "read" permission)
    - Check data.status for "PAID", "FAILED", or "CANCELLED".
```

---

## 6. Error Reference

### Payment API Errors

| HTTP Status | Error Message | Cause |
|-------------|---------------|-------|
| `400` | `"Refund amount is required"` | Missing `amount` in refund body |
| `400` | `"Invalid refund amount"` | `amount` ≤ 0 |
| `400` | `"No successful payment found"` | Refund attempted on order with no `SUCCEEDED` payment |
| `400` | `"Refund exceeds available balance"` | `amount` > (paid amount − previously refunded) |
| `400` | `"Invalid ProductId or productPlanId"` | `ProductId or productPlanId` not found or inactive for your product |
| `400` | `"Invalid plan configuration"` | Plan has no `price` or `currency` |
| `404` | `"Order not found"` | Order ID not found or belongs to a different product |
| `404` | `"Payment not found"` | Order ID not found on `GET /api/payments/:id` |
| `5xx` | `"Failed to create payment"` | Internal error during order/Tilled checkout creation |
| `5xx` | `"Failed to process refund"` | Internal error during refund processing |

### Validation Errors (`400 Bad Request`)

Returned as:
```json
{
  "success": false,
  "errors": [
    { "field": "referenceId", "message": "referenceId is required" }
  ]
}
```

| Field | Validation Rule |
|-------|----------------|
| `externalUserId` / `productUserId` | At least one required, must be a non-empty string |
| `name` / `user_name` | At least one required, non-empty string, max 100 chars |
| `email` / `user_email` | At least one required, must match `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` |
| `referenceId` | Required, non-empty string |
| `productPlanId` | Required, non-empty string |
| `platform_fee_amount` | Optional; if provided must be numeric |

### Authentication / Authorization Errors

| HTTP Status | Error Message | Cause |
|-------------|---------------|-------|
| `401` | `"Missing API key"` | `x-api-key` header absent |
| `401` | `"Authentication required"` | No `req.apiKey` set (usually internal middleware ordering issue) |
| `403` | `"Invalid API key"` | Key not found by prefix, or bcrypt comparison failed |
| `403` | `"API key has expired"` | `expiresAt` is in the past |
| `403` | `"Insufficient permissions"` | API key lacks the required permission |
| `429` | `"Rate limit exceeded"` | Requests exceed `rateLimitPerMin` per minute |
| `500` | `"Authentication failed"` | Unexpected error in auth middleware |

### Idempotency Errors

| HTTP Status | Error Message | Cause |
|-------------|---------------|-------|
| `409` | `"Idempotency-Key reused with different payload"` | Same key used with a different request body |
| `409` | `"Request is currently processing"` | Request with same key is still in-progress (< 60s since creation) |
| `500` | `"Idempotency lookup failed RECORD_NOT_FOUND"` | Race condition — record disappeared between existence check and lookup |

### Webhook Errors (Tilled → This Service)

| HTTP Status | Cause |
|-------------|-------|
| `400` | Missing `tilled-signature` header |
| `400` | Signature verification failed (mismatch or malformed header) |
| `500` | Internal error during event processing (signals Tilled to retry) |
| `200` | Success (`{ "received": true }`) |

### Admin / Webhook Config Errors

| HTTP Status | Error Message | Cause |
|-------------|---------------|-------|
| `400` | `"productId, triggerEvent and callbackUrl are required"` | Missing required fields |
| `400` | `"Invalid callbackUrl format"` | `callbackUrl` is not a valid URL |
| `400` | `"maxRetries must be >= 0"` | Negative value |
| `400` | `"retryDelayMs must be >= 0"` | Negative value |
| `401` | `"Admin secret key is missing"` | `x-admin-secret` header absent on admin routes |
| `403` | `"Invalid admin secret key"` | Wrong value for `x-admin-secret` |

### Generic / Global Errors

| HTTP Status | Error Message | Cause |
|-------------|---------------|-------|
| `404` | `"Route not found"` | Unknown path/endpoint |
| `503` | `{ "status": "error", "database": "disconnected" }` | Database unreachable (health check) |
| `5xx` | `err.message` or `"Internal server error"` | Unhandled exception. Stack trace included in [development](file:///home/anil/Desktop/payment-backend/.env.development) env |

---

## 7. Integration Checklist

Use this checklist to go from zero to live integration:

### Setup (Coordinate with Payment Service Team)

- [ ] **Register your product** — Ensure your platform has a [Product](file:///home/anil/Desktop/payment-backend/src/controllers/productWebhook.controller.js#66-70) record with a unique `code` (e.g., `lms`, `ebook`).
- [ ] **Create a Product Plan** — Set price (in cents/smallest unit), currency, and `billingType` (`ONE_TIME` or `RECURRING`). Note the `productPlanId` UUID.
- [ ] **Generate an API key** — Request API key generation with permissions matching your use case (`charge`, [refund](file:///home/anil/Desktop/payment-backend/src/controllers/payments.controller.js#106-145), `read`). **Store the key immediately** — it won't be shown again.
- [ ] **Register your webhook callback URL** — Call `POST /admin/webhooks` with your `callbackUrl` and `triggerEvent` (e.g., `payment_intent.succeeded`).

### Development

- [ ] **Confirm base URL** — Get the deployed service base URL from the team.
- [ ] **Confirm Tilled environment** — Verify whether sandbox or production keys are in use.
- [ ] **Implement POST /api/payments** — Send `x-api-key`, `referenceId` (your order ID), `productPlanId`, user fields.
- [ ] **Handle `checkoutUrl` in response** — Redirect your user to this URL to complete payment.
- [ ] **Implement idempotency** — Generate a `UUID v4` per checkout attempt; send as `Idempotency-Key` header. Reuse the same key for retries.
- [ ] **Handle duplicate responses** — Check `duplicate: true` in the response to detect already-processed orders; don't create duplicate orders on your side.

### Webhook & Status

- [ ] **Poll for status** (until callbacks go live) — Use `GET /api/payments/:orderId` with a `read` key to check `data.status` for `PAID` / `FAILED` / `CANCELLED`.
- [ ] **Implement webhook receiver** *(future)* — Your `callbackUrl` endpoint should return `HTTP 2xx` immediately.
- [ ] **Handle all terminal states** — `PAID`, `FAILED`, `CANCELLED`, `REFUNDED`, `PARTIALLY_REFUNDED`.

### Refunds

- [ ] **Implement refund flow** — Call `POST /api/payments/:orderId/refund` with `amount` (cents) and optional `reason`.
- [ ] **Validate refund amount** — Ensure `amount` ≤ (paid amount − previously refunded).

### Health & Operations

- [ ] **Check service health** — `GET /health` returns `{ status: "ok", database: "connected" }` when live.
- [ ] **Monitor rate limits** — Watch `X-RateLimit-Remaining` header; handle `429` with exponential backoff using `Retry-After`.
- [ ] **Test in sandbox** — Confirm Tilled sandbox credentials are used in non-production environments.

---

## 8. Known Gaps & Work In Progress

The following items were found in the codebase as stubs, TODOs, or incomplete implementations. **These must be resolved before the documentation above can be considered fully accurate for a production integration.**

### 🔴 Critical

| # | File | Issue |
|---|------|-------|
| 1 | `src/services/payments.service.js:396–401` | **Refund Tilled API call is stubbed.** The comment reads `// TILLED TEAM: Implement actual Tilled API call here`. Currently, the refund immediately sets status to `SUCCEEDED` with `tilledRefundId: "simulated_tilled_refund_id"`. No real money is refunded. |
| 2 | `src/app.js:70–76` | **Admin routes have no authentication.** Routes `/api/products`, `/api/keys`, `/api/product-plan`, `/api/crud` are explicitly noted as unprotected with the comment: *"SECURE THESE IN PRODUCTION!"* A TODO for admin auth middleware is present but not implemented. |
| 3 | **No outgoing webhook dispatcher found** | The `ProductWebhookConfig` and `OutgoingWebhookDelivery` models exist in the schema, and the admin API to create configs exists (`POST /admin/webhooks`), but there is **no code** that reads these configs and POSTs to your `callbackUrl` after processing a Tilled event. Integration teams cannot rely on push notifications today. |

### 🟡 Incomplete / Stub Logic

| # | File | Issue |
|---|------|-------|
| 4 | [src/services/webhookHandlers/charge.handler.js](file:///home/anil/Desktop/payment-backend/src/services/webhookHandlers/charge.handler.js) | The `charge.succeeded`, `charge.failed`, and `charge.refunded` events are routed to [handleChargeEvent](file:///home/anil/Desktop/payment-backend/src/services/webhookHandlers/charge.handler.js#1-4) which **only** does a `console.log`. No DB update, no state change, no refund record update on `charge.refunded`. |
| 5 | `src/app.js:6,21` | `auditLogger` middleware is commented out (`// app.use(auditLogger)`). The `AuditLog` model is fully defined in the schema but is never written to. |
| 6 | `src/middleware/idempotency.js:426–428` | `IdempotencyStatus` enum only has `IN_PROGRESS` and `COMPLETED` — `FAILED` and `CANCELLED` states used in the middleware logic are handled by deletion, not a proper enum value. This inconsistency could cause confusion during debugging. |

### 🟠 Configuration / Hardcoded Values

| # | File | Issue |
|---|------|-------|
| 7 | `src/services/payments.service.js:268–269` | **Success and cancel URLs are hardcoded** to `https://payment-pagess.netlify.app/success` and `https://payment-pagess.netlify.app/cancelled`. These should be configurable per product or per request before going to production. |
| 8 | `src/services/payments.service.js:273` | `payment_method_types` is hardcoded to `["card"]`. ACH and wallet are defined as `PaymentMethod` enum values but not reflected in checkout session creation. |
| 9 | [.env.development](file:///home/anil/Desktop/payment-backend/.env.development) | **Development env file contains real Tilled sandbox credentials** (secret key, account ID, webhook secret). These are committed in plaintext and should be rotated and moved to a secrets manager before production deployment. |

### 🟢 Minor / Low Risk

| # | File | Issue |
|---|------|-------|
| 10 | `src/routes/payments.routes.js:35,46,58` | Comments `// You'll need to add this controller method` remain on [getPayments](file:///home/anil/Desktop/payment-backend/src/controllers/payments.controller.js#43-68), [getPaymentById](file:///home/anil/Desktop/payment-backend/src/services/payments.service.js#315-325), and [refundPayment](file:///home/anil/Desktop/payment-backend/src/controllers/payments.controller.js#106-145). The methods are implemented but the stale comments are misleading. |
| 11 | `src/controllers/productPlan.controller.js:13–20` | `EBOOK`-specific plan creation logic returns a `bookId` field, but the `ProductPlan` model has no `bookId` field in the schema. This appears to reference a deleted or planned field. |
| 12 | `prisma/schema.prisma:490–496` | `OrderType` enum includes `CANCEL`, `REFUND`, `OTHER` but order creation always sets `OrderType` to `ONE_TIME` (default). Subscription and other order types are not populated in code. |
