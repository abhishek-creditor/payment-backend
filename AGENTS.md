# Payment backend — agent context

## Project summary

Node.js + Express payment microservice. Multi-tenant (one product = one API key).
Currently integrated with Tilled as the only payment gateway. Prisma ORM, PostgreSQL.

## Active work — what we are building

Three initiatives are in progress. Do not mix them up.

### Initiative 1 — Multi-gateway abstraction (NOT STARTED)

**Goal:** Support Tilled, Stripe, Razorpay (and future gateways) from a single codebase.

**Planned architecture (nothing built yet):**
- `src/services/gateways/gateway.interface.js` — abstract base class all adapters implement
- `src/services/gateways/tilled.gateway.js` — wraps existing `tilled.service.js`, zero new logic
- `src/services/gateways/gateway.factory.js` — resolves the correct adapter using routing rules
- `ProductGatewayConfig` / `GlobalGatewayConfig` — DB models for routing rules (NOT in schema yet)

**What is NOT done yet (all tasks):**
- None of the gateway abstraction files exist yet
- `src/services/gateways/` directory does not exist
- Webhook routes still hardcoded to `/api/webhooks/tilled` (not parameterized as `:gateway`)
- Schema does not have `ProductGatewayConfig` or `GlobalGatewayConfig` models
- `webhook.controller.js` still uses `TilledService.verifyWebhookSignature()` directly

### Initiative 2 — Multi-currency / country-based pricing (CODE COMPLETE, MIGRATION PENDING)

**Goal:** Allow per-currency pricing per plan, resolved from the user's country code or direct currency.

**Completed code:**
- `ProductPlanPrice` model in `schema.prisma` — one row per currency per plan, with optional `gateway` override
- `src/config/countryCurrency.js` — static country→currency map (ISO 3166-1 → ISO 4217)
- `src/utils/currency.js` — currency normalisation utility (`toMinorUnit`, `fromMinorUnit`, `formatAmount`, `isKnownCurrency`) with support for zero-decimal (JPY), two-decimal (USD/INR), and three-decimal (KWD) currencies
- `src/dao/productPlanPrice.dao.js` — CRUD DAO for ProductPlanPrice (findPrice, listPricesForPlan, createPrice, updatePrice, deletePrice)
- `src/services/planPrice.service.js` — business logic: `resolvePlanPrice(planId, country)`, `resolvePlanPriceByCurrency(planId, currency)`, `getSupportedCountries()`, `getPlanPricingMatrix(planId)`
- `src/controllers/planPrice.controller.js` — admin CRUD + supported-currencies + pricing-matrix + resolve-price (supports both `?country=IN` and `?currency=INR`)
- `src/routes/planPrice.routes.js` — mounted at `/admin/plans` in `app.js`
- `src/services/payments.service.js` — `createPayment()` accepts `country` OR `currency` directly. Resolution priority: explicit `currency` > `country` > legacy `plan.price`/`plan.currency` fallback
- `src/services/payments.service.js` — `confirmSubscriptionPayment()` now uses `order.amount` / `order.currency` instead of hardcoded `plan.price` / `plan.currency`
- `src/middleware/validatePaymentRequest.js` — `country` (2-letter) and `currency` (3-letter) fields validated (both optional, auto-uppercased)
- `src/dao/productPlan.dao.js` — `getAllPlans()` and `getPlanById()` now include `prices` relation

**Admin APIs:**
- `GET  /admin/plans/supported-currencies` — list all supported countries + currencies
- `POST /admin/plans/:planId/prices` — add a currency-price (body: `{ currency, amount, gateway? }`)
- `GET  /admin/plans/:planId/prices` — list all prices for a plan
- `PUT  /admin/plans/:planId/prices/:currency` — update a price
- `DELETE /admin/plans/:planId/prices/:currency` — remove a price
- `GET  /admin/plans/:planId/pricing-matrix` — full pricing overview (configured + missing currencies)
- `GET  /admin/plans/:planId/resolve-price?country=IN` — dry-run price resolution by country
- `GET  /admin/plans/:planId/resolve-price?currency=INR` — dry-run price resolution by currency directly

**⚠️ BLOCKER:** Migration has NOT been run. Run `npx prisma migrate dev --name add_product_plan_price` before testing.

**What is NOT done yet:**
- Run the Prisma migration
- Drop old `price`/`currency` columns from `ProductPlan` after full migration verified
- Fix edge case: order retries with different `country` can create currency mismatch (see Known Bugs below)

### Initiative 3 — RabbitMQ async queue (NOT STARTED)

**Goal:** Replace in-memory retry loops and raw Promises with a durable message queue.

**Current pain points in the codebase:**
- `webhookDispatcher.service.js` — `attemptDelivery()` retries via `setTimeout`. If process restarts mid-retry, job is lost silently.
- `webhook.controller.js` — `processWebhookEventAsynchronously(event).catch(...)` is an unguarded Promise. If it throws after DB write but before dispatcher, job disappears.

**Planned queues:**
- `webhook.inbound` — inbound gateway events waiting to be processed. durable, DLQ on nack.
- `webhook.outgoing` — delivery jobs waiting to POST to product `callbackUrl`. durable, retryable.
- `webhook.dlq` — dead letter queue for exhausted jobs.

**What is NOT done yet (all tasks):**
- `amqplib` dependency not installed
- `src/config/rabbitmq.js` — connection module (does not exist)
- `src/workers/gatewayEventWorker.js` — consumes `webhook.inbound` (does not exist)
- `src/workers/webhookDeliveryWorker.js` — consumes `webhook.outgoing` (does not exist)
- Webhook controller not updated to publish to queue

## Known bugs found in audit (2026-04-23)

### Critical
1. **Migration not run** — `ProductPlanPrice` model in schema but table doesn't exist in DB
2. **Lost webhook events** — `processWebhookEventAsynchronously()` is an unguarded background Promise. Process restart = event lost forever
3. **Currency mismatch on order retry** — if user retries `POST /api/payments` with a different `country`, new payment gets new amount but order still has old amount/currency. `confirmSubscriptionPayment` reads order amount → wrong value
4. **setTimeout retry loss** — `webhookDispatcher.attemptDelivery()` uses in-memory setTimeout. PM2 restart during retry = attempts lost

### High
5. **[COMPLETED] Rate limit tracker table grows forever** — Fixed by adding `deleteOldTrackers(1 hour ago)` to the idempotency cron.
6. **[COMPLETED] Idempotency cron too aggressive** — Fixed to use `IDEMPOTENCY_TTL_SECONDS` (default 50m) and `IDEMPOTENCY_IN_PROGRESS_TIMEOUT`.
7. **[COMPLETED] CORS missing `x-admin-secret`** — Added `x-admin-secret` to `allowedHeaders` in `app.js`.
8. **Generic CRUD routes unprotected** — `/api/crud` has no auth middleware and unknown purpose

### Medium
9. **[COMPLETED] Canada mapped to USD** — `countryCurrency.js` now maps `CA: 'CAD'`.
10. **Subscription cancellation missing tilledAccountId** — `tilledAccountId` from `req.body` can be null, Tilled API call may fail
11. **Webhook route still hardcoded** — `POST /api/webhooks/tilled` not parameterized as `:gateway`

## Existing architecture (what was here before our work)

**Auth flow:** `x-api-key` header → prefix lookup → bcrypt compare → permission check → rate limit (per-minute sliding window via `RateLimitTracker`) → sets `req.productId`

**Delegate mode:** If API key has `delegate` permission and request body has `productCode`, auth middleware resolves the actual target product from that code. Allows shared checkout frontend to pay on behalf of different products.

**Idempotency:** `Idempotency-Key` header → SHA256 hash of body → `IdempotencyKey` table → replay cached response on duplicate. TTL 50 min. Status transitions: `IN_PROGRESS` → `COMPLETED` / `FAILED` / `CANCELLED`.

**Payment flow (one-time):** `POST /api/payments` → create Order (CREATED) + Payment (INITIATED) → create/find Tilled customer → create Tilled checkout session → return `checkoutUrl` → Tilled webhook fires → update Payment + Order status.

**Subscription flow:** `POST /api/payments` returns `checkoutUrl` pointing to hosted Tilled.js page → user enters card → frontend calls `POST /api/payments/confirm` with `payment_method_id` → attach PM to Tilled customer → create Tilled subscription → update DB → subscription webhooks handle renewals.

**Webhook processing (current):** `POST /api/webhooks/tilled` → verify signature → save `WebhookEvent` → background Promise → switch on `event.type` → payment/subscription handlers → `webhookDispatcher.dispatch()` → POST to product `callbackUrl`.

**Multi-product tenancy:** Each product has its own `ProductPlan` rows, API keys, orders, and webhook configs. Isolated by `productId` on every query.

**Admin routes (partially protected):**
- `/admin/idempotency` — protected by `adminOnly` middleware (`x-admin-secret` header)
- `/admin/webhooks` — NOT protected
- `/admin/plans` — NOT protected (multi-currency price management)
- `/api/products`, `/api/keys`, `/api/product-plan`, `/api/crud` — NOT protected

## Tech stack

- Runtime: Node.js, Express 5
- ORM: Prisma 6, PostgreSQL
- Auth: bcryptjs for API key hashing
- HTTP client: axios (outgoing webhooks), undici (Tilled API calls)
- Validation: express-validator
- Process manager (prod): PM2

## Key conventions

- DAOs always accept `tx` as first arg (Prisma transaction client or null for direct queries)
- Services never import DAOs from other domains — always go through the correct DAO
- All monetary amounts stored in smallest currency unit (cents, paise). Never floats.
- `AGENTS.md` is the source of truth for project state. Update it when completing a task.

## Environment variables in use

```
DATABASE_URL
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

## Suggested next tasks (in priority order)

1. **Run the ProductPlanPrice migration** — `npx prisma migrate dev --name add_product_plan_price`
2. **Fix order retry currency mismatch** — reject retries where resolved currency differs from order currency
3. **Build gateway abstraction layer** — gateway.interface.js, tilled.gateway.js, gateway.factory.js
4. **Build RabbitMQ integration** — install amqplib, create rabbitmq.js config, workers