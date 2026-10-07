-- Every claim made before the tag handoff was made under "submitting the popup is the opt-in", so its
-- consent is true. Without this a legacy FAILED claim retried through the new flow would be created
-- in Shopify as unsubscribed-by-default. Data only; the column keeps its safe default of false.
UPDATE "welcome_offer_claims" SET "marketing_consent" = true WHERE "marketing_consent" = false;
