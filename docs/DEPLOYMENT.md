# Trekiva Discount: deployment (Elestio VM)

Stack: `nginx` (TLS) → `trekiva-app` (Node 22, non-root) → `postgres` (internal network only, persistent volume).

## 0. Prerequisites
- Elestio VM (Ubuntu) with Docker + Docker Compose, a DNS A record such as `trekiva-app.example.com` → the VM.
- A Shopify Partner app (custom or public) named **Trekiva Discount**.
- Protected Customer Data access requested for the app (we read customer emails).

## 1. Configure the VM
```sh
git clone <your repo> /opt/trekiva && cd /opt/trekiva/trekiva-app   # or copy the project
cp .env.example .env
```
Edit `.env`:
- `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`: from the Partner Dashboard.
- `SHOPIFY_APP_URL=https://trekiva-app.example.com`, `SERVER_NAME=trekiva-app.example.com`.
- `POSTGRES_PASSWORD=$(openssl rand -hex 24)` (hex keeps it URL-safe; it is embedded in `DATABASE_URL`).
- Leave `DATABASE_URL` alone in production: compose builds it from the `POSTGRES_*` values.

Never commit `.env`.

## 2. HTTPS: pick one

**A. Elestio's managed reverse proxy (recommended on Elestio).** Elestio terminates TLS.
1. In `.env` set `APP_BIND=172.17.0.1` (the Docker bridge address Elestio's proxy reaches) and `APP_PORT=3000`.
2. In the Elestio dashboard, point the domain's reverse proxy at port `3000`.
3. Start without the bundled nginx: `docker compose up -d --build postgres trekiva-app`.

**B. Bundled nginx with your own certificates.**
1. Put `fullchain.pem` and `privkey.pem` in `deploy/certs/` (or set `TLS_CERT_DIR`). Let's Encrypt via certbot webroot works: use `deploy/acme/` as the webroot.
2. `docker compose up -d --build`

Traefik works too: drop the `nginx` service, add Traefik labels to `trekiva-app` (router rule for your host, `loadbalancer.server.port=3000`, TLS resolver). The app needs no other proxy config; keep forwarding `X-Forwarded-For` (append).

The app runs `prisma migrate deploy` on every start, so deploys apply migrations automatically.

## 3. Point Shopify at the deployment
Edit `shopify.app.toml` with the real values (from the project directory, on your laptop):
- `client_id`, `application_url = "https://trekiva-app.example.com"`
- `[auth] redirect_urls = ["https://trekiva-app.example.com/auth/callback"]`
- `[app_proxy] url = "https://trekiva-app.example.com/api/public"` (subpath `trekiva`, prefix `apps`)

Then `shopify app deploy`. This registers webhooks (including `customers/update`, which needs Protected Customer Data access), the app proxy and the theme app extension. It also removes the old **Welcome Offer Claimed** Flow trigger, which is no longer used. Then run `npx prisma migrate deploy` (additive migration `flow_handoff_via_tags`).

No Shopify Plus requirement: the workflow starts from Flow's native **Customer tags added** trigger.

## 4. Merchant setup (once per store)
1. Install the app. Open **Status**: every row should be OK (Flow shows "No trigger fired yet" until the first claim).
2. Shopify Admin → Discounts: have a code discount (e.g. `WELCOME10`) with **one use per customer** and eligibility
   **All customers**, or the segment **Customers who haven't purchased** for a first-order-only offer.
3. **Online Store → Themes → Customize → App embeds**: enable **Trekiva Popup**.
4. On the campaign's discount in Shopify Admin, keep **Limit to one use per customer** on, and keep the base code
   private. Recommended: set **Limit number of times this discount can be used in total** to 1 — Shopify applies that
   limit to each code separately, so it makes every per-claim code single-use while the number of claims stays
   unlimited. Leaving it unlimited means a forwarded code still works for other customers.
   The app itself allows one claim per email address. Order history is only checked when the campaign's
   **First-time customers only** rule is on (Display rules); with it off, returning customers can claim.
   Note that **Limit to one use per customer** does *not* mean "first order only" - it only stops a
   customer reusing their own code.

   The two first-order gates are complementary, not alternatives:
   - The **Shopify segment** is the enforcement. It cannot be bypassed, but it is only applied at
     checkout, so an ineligible customer still claims a code and is refused when they try to use it.
   - The **app rule** is the experience. It refuses them at the popup, so no code and no email are
     issued for an offer they could never redeem.

   Use the segment alone and returning customers get a dead code by email; use the app rule alone and a
   customer who orders between claiming and checkout can still redeem. Turning both on covers each gap.
5. **Status → Create metafield definitions** (or add the five `trekiva.*` customer metafields under Status → Custom data).
6. Shopify Flow: create a workflow with trigger **Customer tags added** → condition tags contain `trekiva_welcome_claimed` → action **Send marketing email** (use the customer metafield `trekiva.welcome_discount_code`) → action **Add customer tags** `trekiva_welcome_email_sent`. Turn it on. Send yourself a test first: Shopify does not document that Shopify Email can render customer metafields.
7. Create a campaign, select the discount, set status **Active**, save.
8. Test with a fresh email: expect the success message and an email with a unique code (e.g. `WELCOME10-7KQ2M9XH`). Submit again: expect "Already claimed" and no second email. A customer who unsubscribed earlier still gets a valid code, but Shopify Email will not send to them.

## 4b. Send the welcome email from the app (optional)

Do this to show each customer their own code in the email. Until it is done, nothing changes: Shopify Flow keeps sending.

1. Create a Resend account and an API key (sending access is enough).
2. In Resend, add and verify your sending domain (DNS records). `EMAIL_FROM` must be on it.
3. Set on the server, then restart: `RESEND_API_KEY=...`, `EMAIL_FROM="Trekiva <care@trekiva.com>"` and optionally
   `EMAIL_REPLY_TO=...`. (Both of the first two must be set; docker-compose already passes them through.)
4. `npx prisma migrate deploy` (two additive migrations: `campaigns.email` and `welcome_offer_claims.delivery`).
5. **Status** should now show "Welcome email sending: OK". Edit your campaign, open step 8 "Welcome email", design the
   email and use **Send test** to see it in your own inbox.
6. **Turn off the Shopify Flow email workflow.** New claims are sent by the app and get no Flow tag, so a workflow left on
   would do nothing for them, but switching it off avoids any chance of a duplicate.
7. Claims made before this stay with Flow and are never emailed again by the app.

Product sections need the `read_products` permission: add it to `SCOPES` on the server (already in `shopify.app.toml`),
run `shopify app deploy`, then approve the new permission when Shopify asks in the admin. Status shows whether it is granted.

Notes: use JPG or PNG images (Outlook cannot show WebP). The email's button links to
`https://<shop>.myshopify.com/discount/<CODE>`, which applies the code and redirects to your store.

## 5. Operations
- Failed claims: **Status** shows why each one failed (customer, discount, metafields or tag step) and has a **Retry failed claims** button. It also checks that every active campaign's Shopify discount still exists and is live.
- Health: `GET /healthz` (checks the database). Docker marks `trekiva-app` unhealthy if it fails.
- Logs: `docker compose logs -f trekiva-app` (JSON; tokens and emails are redacted).
- Backups: `deploy/backup.sh` (cron daily; keeps 14 days). Restore: `gunzip -c backups/<file> | docker compose exec -T postgres psql -U $POSTGRES_USER -d $POSTGRES_DB`.
- Update: `git pull && docker compose up -d --build`.
- Postgres publishes no ports and sits on an `internal` network with no route to the internet. Do not add a `ports:` entry to it.

## 6. Known limits
- The rate limiter is in memory, so run a single app instance.
- `EMAIL_SENT` means Flow ran its email action and added `trekiva_welcome_email_sent`; it cannot prove Shopify Email delivered the message.
