-- Flow app extensions are Plus-only for custom apps, so the app now sends the welcome
-- email itself. `flow_triggered_at` collapses into `email_sent_at`, and the TRIGGERED
-- status (meaning "handed to Flow") becomes SENT.

-- Claims whose trigger fired did reach the customer, so carry the timestamp over.
UPDATE "welcome_offer_claims"
SET "email_sent_at" = "flow_triggered_at"
WHERE "email_sent_at" IS NULL AND "flow_triggered_at" IS NOT NULL;

UPDATE "welcome_offer_claims"
SET "email_status" = 'SENT'
WHERE "email_status" = 'TRIGGERED';

-- PostgreSQL cannot drop an enum value, so the type is rebuilt without TRIGGERED.
ALTER TYPE "EmailStatus" RENAME TO "EmailStatus_old";
CREATE TYPE "EmailStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'NOT_SUBSCRIBED');
ALTER TABLE "welcome_offer_claims" ALTER COLUMN "email_status" DROP DEFAULT;
ALTER TABLE "welcome_offer_claims"
  ALTER COLUMN "email_status" TYPE "EmailStatus" USING ("email_status"::text::"EmailStatus");
ALTER TABLE "welcome_offer_claims" ALTER COLUMN "email_status" SET DEFAULT 'PENDING';
DROP TYPE "EmailStatus_old";

ALTER TABLE "welcome_offer_claims" DROP COLUMN "flow_triggered_at";
