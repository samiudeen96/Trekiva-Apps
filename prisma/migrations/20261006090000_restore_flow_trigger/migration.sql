-- Reverts 20261005104500_email_delivery_without_flow: delivery goes back to Shopify Flow, so
-- `email_sent_at` stops being the point of no return and `flow_triggered_at` returns.

ALTER TABLE "welcome_offer_claims" ADD COLUMN "flow_triggered_at" TIMESTAMP(3);

-- A claim whose email went out counts as triggered; an opted-out claim was settled without one.
UPDATE "welcome_offer_claims"
SET "flow_triggered_at" = COALESCE("email_sent_at", "updated_at")
WHERE "email_status"::text IN ('SENT', 'NOT_SUBSCRIBED');

-- Flow cannot report delivery, so "handed off" is TRIGGERED again. PostgreSQL cannot drop an
-- enum value and a new one cannot be used in the transaction that adds it, so rebuild the type.
ALTER TYPE "EmailStatus" RENAME TO "EmailStatus_old";
CREATE TYPE "EmailStatus" AS ENUM ('PENDING', 'TRIGGERED', 'SENT', 'FAILED', 'NOT_SUBSCRIBED');
ALTER TABLE "welcome_offer_claims" ALTER COLUMN "email_status" DROP DEFAULT;
ALTER TABLE "welcome_offer_claims"
  ALTER COLUMN "email_status" TYPE "EmailStatus"
  USING (CASE WHEN "email_status"::text = 'SENT' THEN 'TRIGGERED' ELSE "email_status"::text END::"EmailStatus");
ALTER TABLE "welcome_offer_claims" ALTER COLUMN "email_status" SET DEFAULT 'PENDING';
DROP TYPE "EmailStatus_old";

-- Only the Resend send path wrote this; under Flow nothing observes it.
UPDATE "welcome_offer_claims" SET "email_sent_at" = NULL;
