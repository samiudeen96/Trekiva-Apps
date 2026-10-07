/**
 * The contract between this app and the merchant's Shopify Flow workflow. Pure (no server
 * imports) so the admin UI, the gateways and the tests all read the same names.
 */

/** Added LAST, after the metafields exist. Flow's "Customer tags added" trigger starts on it. */
export const TAG_CLAIMED = "trekiva_welcome_claimed";
/** Added by the merchant's Flow after its email action. The app only reads it. */
export const TAG_EMAIL_SENT = "trekiva_welcome_email_sent";

export const METAFIELD_NAMESPACE = "trekiva";

export interface MetafieldSpec {
  key: string;
  type: "boolean" | "single_line_text_field" | "date_time";
  name: string;
  description: string;
}

export const CLAIM_METAFIELDS: MetafieldSpec[] = [
  { key: "welcome_offer_claimed", type: "boolean", name: "Welcome offer claimed", description: "True once the customer has claimed the Trekiva welcome offer." },
  { key: "welcome_discount_code", type: "single_line_text_field", name: "Welcome discount code", description: "The customer's own welcome discount code." },
  { key: "welcome_claimed_at", type: "date_time", name: "Welcome offer claimed at", description: "When the welcome offer was claimed." },
  { key: "welcome_campaign_id", type: "single_line_text_field", name: "Welcome campaign ID", description: "Trekiva campaign the offer was claimed from." },
  { key: "welcome_claim_id", type: "single_line_text_field", name: "Welcome claim ID", description: "Trekiva claim record for this offer." },
];

export const tagList = (csv: string): string[] =>
  csv.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
