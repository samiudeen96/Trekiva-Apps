-- Tracks the order that spent a claim's code, so the code can be pulled from the Shopify
-- discount (and put back if that order is cancelled). Additive: existing rows stay NULL.
ALTER TABLE "welcome_offer_claims" ADD COLUMN "redeemed_at" TIMESTAMP(3);
ALTER TABLE "welcome_offer_claims" ADD COLUMN "redeemed_order_id" TEXT;
