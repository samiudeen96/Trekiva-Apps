-- The app can now send the welcome email itself (Resend) from a per-campaign template.
-- Additive only. Every existing claim keeps delivery = FLOW, so it is never emailed again by the app.

CREATE TYPE "EmailDelivery" AS ENUM ('FLOW', 'APP');

ALTER TABLE "campaigns" ADD COLUMN "email" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "welcome_offer_claims" ADD COLUMN "delivery" "EmailDelivery" NOT NULL DEFAULT 'FLOW';
