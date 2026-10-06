-- A redeem code is unique per shop in Shopify, so two claims must never share one.
-- Without this, a (very unlikely) suffix collision would silently hand a second customer
-- a code that the first customer has already spent.
CREATE UNIQUE INDEX "welcome_offer_claims_unique_code_per_shop"
  ON "welcome_offer_claims" ("shop_domain", "discount_code");
