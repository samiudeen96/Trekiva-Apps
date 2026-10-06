-- Records why a claim failed so the admin can see it without reading server logs.
ALTER TABLE "welcome_offer_claims" ADD COLUMN "failure_step" TEXT;
ALTER TABLE "welcome_offer_claims" ADD COLUMN "failure_reason" TEXT;
