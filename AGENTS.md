# Payment backend — agent context

## Project summary

Node.js + Express payment microservice. Multi-tenant (one product = one API key).
Currently integrated with Tilled as the only payment gateway. Prisma ORM, PostgreSQL.

## Active work — what we are building

Two parallel initiatives are in progress. Do not mix them up.

### Initiative 1 — Multi-gateway abstraction (Batch 1 + Batch 2 complete)

**Goal:** Support Tilled, Stripe, Razorpay (and future gateways) from a single codebase.

**Architecture:**
- `src/services/gateways/gateway.interface.js` — abstract base class all adapters implement
- `src/services/gateways/tilled.gateway.js` — wraps existing `tilled.service.js`, zero new logic
- `src/services/gateways/gateway.factory.js` — resolves the correct adapter using a 4-level chain:
  1. `ProductPlanPrice.gateway` field (price-row override, skips all routing)
  2. `ProductGatewayConfig` (product-specific routing rules)
  3. `GlobalGatewayConfig` specific rules (applies to ALL products)
  4. `GlobalGatewayConfig.isDefault = true` (system-wide catch-all)

**New DB models (already migrated):**
- `ProductGatewayConfig` — per-product routing rules (billingType, currency, amount range)
- `GlobalGatewayConfig` — same structure, but applies to all products when no product rule matches
- `ProductPlanPrice` — replaces the single `price`/`currency` on `ProductPlan`. One row per currency per plan. Amount is set manually per market (NOT a currency conversion).

**Admin APIs:**
- `POST /admin/gateways/configs` — create product-level gateway routing rule
- `POST /admin/global-gateways` — create global routing rule (affects all products)
- `GET  /admin/global-gateways/preview?productId=&billingType=&currency=&amount=` — dry-run the factory
- `POST /admin/gateways/plans/:planId/prices` — add a currency price to a plan

**Key files modified:**
- `src/services/payments.service.js` — now calls `getGateway()` instead of TilledService directly. Reads `ProductPlanPrice` for amount/currency. Still falls back to legacy `plan.price`/`plan.currency` if no prices exist.
- `src/controllers/webhook.controller.js` — now uses `getGatewayByName(req.params.gateway)` for signature verification
- `src/routes/webhook.routes.js` — route is now `POST /api/webhooks/:gateway`

**What is NOT done yet (next tasks):**
- `src/services/gateways/stripe.gateway.js` — Stripe adapter (not started)
- `src/services/gateways/razorpay.gateway.js` — Razorpay adapter (not started)
- Drop old `price`/`currency` columns from `ProductPlan` after full migration verified

### Initiative 2 — RabbitMQ async queue (partially scaffolded)

**Goal:** Replace in-memory retry loops and raw Promises with a durable message queue.

**Current pain points in the codebase:**
- `webhookDispatcher.service.js` — `attemptDelivery()` retries via `setTimeout`. If process restarts mid-retry, job is lost silently.
- `webhook.controller.js` — `processWebhookEventAsynchronously(event).catch(...)` is an unguarded Promise. If it throws after DB write but before dispatcher, job disappears.

**Completed scaffolding:**
- `src/config/rabbitmq.js` — connection module, queue assertions, `publish()` helper
- `src/controllers/webhook.controller.js` — updated to publish to `webhook.inbound` after signature verification, returns 200 immediately

**Queues:**
- `webhook.inbound` — inbound gateway events waiting to be processed. durable, DLQ on nack.
- `webhook.outgoing` — delivery jobs waiting to POST to product `callbackUrl`. durable, retryable.
- `webhook.dlq` — dead letter queue for exhausted jobs. inspect via management UI :15672.

**What is NOT done yet (next tasks):**
- `src/workers/gatewayEventWorker.js` — consumes `webhook.inbound`, runs payment/subscription handlers, acks on success, nacks to DLQ on failure, publishes to `webhook.outgoing`
- `src/workers/webhookDeliveryWorker.js` — consumes `webhook.outgoing`, POSTs to `callbackUrl`, acks on 2xx, re-publishes with backoff on failure, nacks to DLQ after `maxRetries`

## Existing architecture (what was here before our work)

**Auth flow:** `x-api-key` header → prefix lookup → bcrypt compare → permission check → rate limit (per-minute sliding window via `RateLimitTracker`) → sets `req.productId`

**Idempotency:** `Idempotency-Key` header → SHA256 hash of body → `IdempotencyKey` table → replay cached response on duplicate. TTL 50 min. Status transitions: `IN_PROGRESS` → `COMPLETED` / `FAILED` / `CANCELLED`.

**Payment flow (one-time):** `POST /api/payments` → create Order (CREATED) + Payment (INITIATED) → create/find Tilled customer → create Tilled checkout session → return `checkoutUrl` → Tilled webhook fires → update Payment + Order status.

**Subscription flow:** `POST /api/payments` returns `checkoutUrl` pointing to hosted Tilled.js page → user enters card → frontend calls `POST /api/payments/confirm` with `payment_method_id` → attach PM to Tilled customer → create Tilled subscription → update DB → subscription webhooks handle renewals.

**Webhook processing (current, before RabbitMQ):** `POST /api/webhooks/tilled` → verify signature → save `WebhookEvent` → background Promise → switch on `event.type` → payment/subscription handlers → `webhookDispatcher.dispatch()` → POST to product `callbackUrl`.

**Multi-product tenancy:** Each product has its own `ProductPlan` rows, API keys, orders, and webhook configs. Isolated by `productId` on every query.

**Admin routes (unprotected — known gap):** `/api/products`, `/api/keys`, `/api/product-plan`, `/api/crud` have no auth middleware. Flagged as a known security gap to fix before production hardening.

## Tech stack

- Runtime: Node.js, Express 5
- ORM: Prisma 6, PostgreSQL
- Auth: bcryptjs for API key hashing
- Queue: amqplib (RabbitMQ) — being added
- HTTP client: axios (outgoing webhooks), undici (Tilled API calls)
- Validation: express-validator
- Process manager (prod): PM2

## Key conventions

- DAOs always accept `tx` as first arg (Prisma transaction client or null for direct queries)
- Services never import DAOs from other domains — always go through the correct DAO
- All monetary amounts stored in smallest currency unit (cents, paise). Never floats.
- `gateway.factory.js` is the ONLY place that imports gateway adapters. Services import the factory.
- When adding a new gateway: (1) create `src/services/gateways/{name}.gateway.js`, (2) register it in `GATEWAY_REGISTRY` in `gateway.factory.js`, (3) add env vars to `.env.development` and `.env.production`, (4) register webhook URL in that gateway's dashboard pointing to `POST /api/webhooks/{name}`
- `AGENTS.md` is the source of truth for project state. Update it when completing a task.

## Environment variables in use

```
DATABASE_URL
RABBITMQ_URL=amqp://payment:password@localhost:5672
TILLED_SANDBOX_SECRET_KEY
TILLED_SANDBOX_PUBLISHABLE_KEY
TILLED_SANDBOX_BASE_URL
TILLED_SANDBOX_WEBHOOK_SECRET
TILLED_SANDBOX_ACCOUNT_ID
FRONTEND_PAYMENT_PAGE_URL
ADMIN_SECRET
NODE_ENV
PORT
IDEMPOTENCY_TTL_SECONDS=3000
IDEMPOTENCY_IN_PROGRESS_TIMEOUT=60
```

## Suggested next task for this agent

Build `src/workers/gatewayEventWorker.js`. It should:
1. Connect to RabbitMQ using `src/config/rabbitmq.js`
2. Consume `QUEUES.INBOUND_WEBHOOK`
3. Switch on `eventType` and call the correct handler from `src/services/webhookHandlers/`
4. After the handler succeeds, call `webhookEventDAO.markAsProcessed()`
5. Publish a delivery job to `QUEUES.OUTGOING_WEBHOOK` for each matching `ProductWebhookConfig`
6. `channel.ack(msg)` on success, `channel.nack(msg, false, false)` on uncaught error (routes to DLQ)