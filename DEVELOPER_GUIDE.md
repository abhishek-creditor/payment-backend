# Payment Backend - Developer Output & Integration Guide

## Introduction

This Payment Backend is a robust, multi-tenant service built with Node.js, Express, and Prisma (PostgreSQL). It is designed to handle payments, subscriptions, and webhooks for multiple distinct "Products" (e.g., LMS, eBook platforms) from a single centralized API. It acts as an abstraction layer over external payment processors (like Tilled).

## Current Features

1. **Multi-Product Architecture:**
   - Supports multiple distinct products/applications using the same backend. Each product has its own API keys and settings.
2. **Secure Authentication & Permissions:**
   - API Key-based authentication with granular permissions (e.g., `["charge", "refund", "read"]`).
   - Rate limiting per API Key to prevent abuse.
3. **Payments & Idempotency:**
   - Process one-time charges securely.
   - Built-in `Idempotency-Key` support ensuring that network retries never result in duplicate charges to the customer.
   - Support for partial or full refunds.
4. **Subscription & Plan Management:**
   - Define diverse billing plans (monthly, yearly, one-time) under each product.
   - Attach customers to plans to handle recurring billing.
5. **Webhook Architecture:**
   - **Incoming Webhooks:** Receives asynchronous updates from payment gateways (e.g., Tilled).
   - **Outgoing Webhooks:** Products can configure webhook endpoints to be notified when events (like successful payments or subscription updates) occur. Features automatic retries and HMAC/Bearer authentication.
6. **Robust Auditing & Logging:**
   - Every request and significant event is tracked via the `ApiRequestLog` and `AuditLog` models for easy debugging and compliance.

---

## Developer Documentation: Integration Guide

If you are a developer tasked with integrating a new product (e.g., an LMS backend) with this Payment Backend, follow these steps:

### 1. Prerequisites & API Keys
Before making any requests, you must have an active **Product Code** and an **API Key**. 
- API Keys must be sent in the header of every protected request:
  ```http
  Authorization: Bearer <YOUR_API_KEY>
  ```
- **Note:** Keep your API Key secure. Do not expose it in frontend applications. It should only be used server-to-server.

### 2. Creating a Payment (One-Time Charge)
To create a payment, send a `POST` request to `/api/payments`.

**Important:** You must include an `Idempotency-Key` in the header to prevent duplicate charges in case of a timeout or network failure.

```http
POST /api/payments
Authorization: Bearer <YOUR_API_KEY>
Idempotency-Key: <UNIQUE_UUID_FOR_THIS_TRANSACTION>
Content-Type: application/json

{
  "productUserId": "user_123", // The ID of the user in your system
  "planId": "plan_abc123",     // The ID of the plan being purchased
  "amount": 5000,              // Amount in smallest currency unit (e.g., 5000 cents = $50.00)
  "currency": "USD"
}
```

### 3. Managing Subscriptions
If your application uses recurring billing, you will create a subscription instead of a one-time payment.

```http
POST /api/subscriptions
Authorization: Bearer <YOUR_API_KEY>
Content-Type: application/json

{
    "productUserId": "user_123",
    "planId": "plan_abc123"
}
```

### 4. Handling Webhooks
Because payment processing is often asynchronous, you should rely on webhooks to deliver ultimate success or failure states rather than waiting for the synchronous HTTP response.

**To set this up:**
1. Configure an Outgoing Webhook URL via the Payment Backend Admin API or Database.
2. In your application, expose a `POST` endpoint (e.g., `POST /webhooks/payment`).
3. Listen for incoming payloads. Typical events include:
   - `PAYMENT_SUCCEEDED`
   - `PAYMENT_FAILED`
   - `SUBSCRIPTION_CREATED`

**Verifying Webhooks:** Verify the incoming request to ensure it actually came from the Payment Backend. Check the Authorization headers you configured (e.g., matching a Bearer token or HMAC signature).

### 5. Best Practices
- **Never store raw credit card details** in your application. Rely on the Payment Backend and its configured processor to handle PCI compliance.
- **Ensure Idempotency keys are truly unique** and tied to the specific user action (e.g., a hash of the user ID, cart ID, and timestamp) and not randomly generated on every retry.
- **Implement rate limiting on your own UI** so users cannot accidentally trigger multiple payment requests at once.
