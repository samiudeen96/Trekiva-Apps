# Trekiva Discount — Architecture

## 1. Final architecture

```
Storefront (Trekiva theme)
  └─ Theme App Extension (app embed, vanilla JS, no deps)
       │  GET  /apps/trekiva/campaigns/active      (config, rules, copy, design)
       │  POST /apps/trekiva/campaigns/:id/claim   { email }
       ▼
Shopify App Proxy  (adds signature + shop; storefront same-origin, no CORS, no secrets)
       ▼
Trekiva Discount  (React Router 7 + Node 22 + TypeScript strict)  ── Nginx/Traefik (TLS) ──
  routes/api.public.*   → verify proxy signature → rate limit → zod → ClaimService
  routes/app.*          → embedded admin (Polaris web components + App Bridge)
  routes/webhooks.*     → app/uninstalled, compliance topics
       │
       ├─ services/claims      ClaimService (idempotent, DB-enforced)
       ├─ services/campaigns   CampaignService / validation / public serialisation
       ├─ shopify/             admin GraphQL clients (customers, discounts, metafields)
       ├─ flow/                flowTriggerReceive wrapper
       └─ repositories/        Prisma access only
       ▼
PostgreSQL (private docker network, persistent volume)  ← source of truth for claims
       ▼
Shopify Flow trigger "Welcome Offer Claimed" → Flow → Shopify Email (sends the code)
```

Key decisions
- **Public API goes through a Shopify App Proxy.** The storefront never talks to the app host directly,
  so there is no CORS surface and every request carries a Shopify-signed HMAC. Route is still
  `POST /api/public/campaigns/:campaignId/claim` on the app; the proxy maps `/apps/trekiva/*` → `/api/public/*`.
- **PostgreSQL decides who has claimed.** The claim row is inserted *first*; the
  `UNIQUE(shop_domain, campaign_id, email_normalized)` constraint (Prisma `P2002`) is the only
  arbiter. No read-then-write race.
- **Flow is fired only by the request that wins the insert.** Flow never does dedup.
- **Failure policy.** If Shopify customer/Flow steps fail after the insert, the claim stays with
  `flow_triggered_at = NULL`, `email_status = FAILED`. A later submit may retry, guarded by an atomic
  compare-and-set (`UPDATE … WHERE flow_triggered_at IS NULL AND retry_lock…`). Once Flow has been
  triggered successfully the email can never be re-triggered (always "already claimed").
- **Discount code is never returned to the storefront.** Each claim gets its own code (`<BASE>-XXXXXXXX`), added to the
  merchant's discount before Flow fires; it is stored on the claim and passed to Flow only. A leaked code can be traced
  to its claim and deleted on its own.
- **Email consent.** New customers, and existing customers whose state is `NOT_SUBSCRIBED`, are subscribed
  (single opt-in) by the popup submission. `UNSUBSCRIBED`/`PENDING`/`INVALID` are never overridden: Flow still fires,
  and the claim is stored as `NOT_SUBSCRIBED` because Shopify Email will skip that customer.
- Admin uses Shopify's current Polaris (web components `s-page`, `s-section`, …) which is what the
  official template ships; the legacy `@shopify/polaris` React package is deprecated.

## 2. Database schema (Prisma, PostgreSQL)

- `Session` — Shopify session storage (template).
- `Campaign` — `id (cuid)`, `shopDomain`, `name`, `type (WELCOME_DISCOUNT)`, `status (DRAFT|ACTIVE|DISABLED)`,
  `template (SPLIT_IMAGE|CENTERED_MINIMAL|IMAGE_BANNER)`, `discountId`, `discountCode`, `discountTitle`,
  `content Json`, `design Json`, `rules Json` (all validated by zod; versioned by `schemaVersion`),
  timestamps. Index `(shopDomain, status)`.
- `WelcomeOfferClaim` — `id`, `shopDomain`, `campaignId → Campaign`, `shopifyCustomerId?`,
  `emailNormalized`, `discountCode`, `claimedAt`, `emailSentAt?`, `flowTriggeredAt?`,
  `emailStatus (PENDING|TRIGGERED|SENT|FAILED|NOT_SUBSCRIBED)`, `createdAt`, `updatedAt`.
  **`@@unique([shopDomain, campaignId, emailNormalized])`**. Indexes on `(shopDomain, claimedAt)`, `campaignId`.

JSON columns keep the popup config flexible so new campaign types/templates need no migration.

## 3. Folder structure

```
app/
  routes/            thin route modules (loaders/actions only)
  components/        admin UI + campaign editor sections
  campaigns/         service, defaults, zod schema for content/design/rules
  claims/            ClaimService, email normalisation, errors
  discounts/         fetch + map Shopify native discounts
  shopify/           admin client helpers, customers, metafields
  flow/              flowTriggerReceive wrapper
  repositories/      Prisma repositories
  validation/        shared zod schemas, input sanitising
  utils/             logger, env, rate-limit, http helpers
  shopify.server.ts  shopifyApp() config
  db.server.ts
prisma/schema.prisma, prisma/migrations
extensions/
  trekiva-popup/     theme app extension (app embed block + assets)
  welcome-offer-flow-trigger/   flow trigger extension
deploy/              nginx.conf, compose helpers
docs/
```

## 4. Shopify scopes

`read_customers,write_customers,read_discounts,write_discounts`

- customers: find by email, create, write `trekiva.*` metafields.
- discounts: list/read existing native code discounts. `write_discounts` is used only to add each claim's own
  redeem code (`discountRedeemCodeBulkAdd`) to the merchant's chosen discount; the app never creates or edits discounts.
  Shopify applies `usageLimit` per code, so the merchant sets it to 1 to make every per-claim code single-use.
- Flow trigger (`flowTriggerReceive`) and theme app extension need no scope.
- Customer data needs Protected Customer Data access (level 2 for email) approved in the Partner Dashboard.

## 5. Shopify Flow architecture

- Extension `flow_trigger` with handle `welcome-offer-claimed`, title **Welcome Offer Claimed**.
- Fields: `customer_id` (customer_reference), `customer_email` (single_line_text), `campaign_name`,
  `discount_code`, `claimed_at` (single_line_text, ISO-8601).
- App calls `flowTriggerReceive(handle, payload)` once, only from the first-claim path.
- Merchant builds the Flow once: *Welcome Offer Claimed → Send marketing email (Shopify Email)* using
  `{{discount_code}}`. Instructions shown on the editor's "Shopify Flow" step.
- `email_sent_at` / `SENT` status cannot be observed from Flow; status is `TRIGGERED` after trigger success
  (Flow's "Send HTTP request" action can optionally call back to mark `SENT`).
- **Availability:** Shopify only shows Flow app extensions from a custom-distribution app on **Shopify Plus**
  stores. On any other plan the trigger is deployed but never appears in Flow's trigger picker, unless the app
  uses public (listed or unlisted) distribution.

## 6. Theme App Extension architecture

- App embed block (`target: body`) — enabled in Theme Editor, no theme file edits.
- Embed passes `shop`, proxy base path via Liquid; JS fetches `/apps/trekiva/campaigns/active`.
- One small JS file + CSS file; templates rendered client-side from config; design via CSS variables.
- Display rules (trigger, delay, pages, devices, frequency) evaluated client-side; frequency stored in
  `localStorage`/`sessionStorage`. Rules never gate the server: claim uniqueness is always enforced in DB.
- States: idle, loading, success, already_claimed, error. Focus trap, ESC close, `aria-modal`, mobile-first.
- `window.TrekivaPopup.open()` for manual trigger.

## 7. API route design

Public (App Proxy, signature-verified, rate-limited, JSON):

| Method | Path (app side) | Purpose |
|---|---|---|
| GET | `/api/public/campaigns/active` | Sanitised config for the active campaign (no discount code) |
| POST | `/api/public/campaigns/:campaignId/claim` | `{email}` → `{status:"claimed"\|"already_claimed", message}` |

Errors: `400 invalid_email`, `404 campaign_not_found`, `429 rate_limited`, `500 server_error` — all `{status:"error", message}`.

Admin (embedded, `authenticate.admin`): `/app` dashboard, `/app/campaigns`, `/app/campaigns/new`,
`/app/campaigns/:id`, `/app/claims`, `/app/settings`; discount list is a resource route `/app/discounts`.

Webhooks: `/webhooks/app/uninstalled`, `/webhooks/app/scopes_update`, `/webhooks/customers/data_request`,
`/webhooks/customers/redact`, `/webhooks/shop/redact`.

## 8. Environment variables

See `.env.example`. Validated at boot with zod (`app/utils/env.server.ts`); the process exits on invalid config.

`NODE_ENV, SHOPIFY_API_KEY, SHOPIFY_API_SECRET, SHOPIFY_APP_URL, SCOPES, DATABASE_URL,
POSTGRES_USER/PASSWORD/DB (compose), LOG_LEVEL, CLAIM_RATE_LIMIT_PER_MIN, SHOP_CUSTOM_DOMAIN?`

## 9. Development phases

1. Setup, auth, Postgres, Prisma, env validation, logger, compliance webhooks, dev compose ← **done in this pass**
2. Campaign model + admin campaign pages
3. Discount selector (Admin GraphQL)
4. Claim API + duplicate protection
5. Shopify customer integration + metafields
6. Flow trigger extension
7. Theme app extension popup
8. Templates + editor/preview
9. Dashboard + claims analytics
10. Docker, Nginx, Elestio deployment (see docs/DEPLOYMENT.md)
