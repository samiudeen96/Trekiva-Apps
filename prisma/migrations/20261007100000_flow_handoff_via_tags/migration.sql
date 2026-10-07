-- Delivery moves from the custom "Welcome Offer Claimed" Flow trigger (Plus only) to Shopify Flow's
-- native "Customer tags added" trigger. Additive only: nothing is dropped, legacy columns and enum
-- values stay so existing claims keep their history.

ALTER TYPE "EmailStatus" ADD VALUE 'READY_FOR_FLOW';
ALTER TYPE "EmailStatus" ADD VALUE 'EMAIL_SENT';

CREATE TYPE "EmailEligibility" AS ENUM ('SUBSCRIBED', 'NOT_SUBSCRIBED', 'UNKNOWN');

ALTER TABLE "welcome_offer_claims" ADD COLUMN "flow_handoff_at" TIMESTAMP(3);
ALTER TABLE "welcome_offer_claims" ADD COLUMN "email_eligibility" "EmailEligibility" NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "welcome_offer_claims" ADD COLUMN "marketing_consent" BOOLEAN NOT NULL DEFAULT false;

-- A claim whose trigger already fired is settled: carry that over so it is never retried.
-- (Compares email_status as text: a value added in this migration cannot be used until it commits.)
UPDATE "welcome_offer_claims" SET "flow_handoff_at" = "flow_triggered_at" WHERE "flow_triggered_at" IS NOT NULL;

UPDATE "welcome_offer_claims"
SET "email_eligibility" = (CASE
  WHEN "email_status"::text = 'NOT_SUBSCRIBED' THEN 'NOT_SUBSCRIBED'
  WHEN "email_status"::text IN ('TRIGGERED', 'SENT') THEN 'SUBSCRIBED'
  ELSE 'UNKNOWN'
END)::"EmailEligibility";

CREATE INDEX "welcome_offer_claims_shop_domain_shopify_customer_id_idx"
  ON "welcome_offer_claims" ("shop_domain", "shopify_customer_id");
