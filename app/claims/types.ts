/** Which fulfilment step a failed claim stopped at (legacy rows may also hold "flow"). */
export type ClaimFailureStep = "customer" | "discount" | "metafields" | "tag";

export type ClaimStatus = "claimed" | "already_claimed" | "not_eligible";

export interface ClaimOutcome {
  status: ClaimStatus;
  message: string;
}

export interface ClaimContext {
  shopDomain: string;
  campaignId: string;
  email: string;
  /** The popup's explicit "email me offers" checkbox. Ignored for an existing claim (its stored value wins). */
  marketingConsent?: boolean;
}

/** What the first-purchase gate needs to know about an email that already exists in Shopify. */
export interface ExistingCustomer {
  /** Customer GID */
  id: string;
  /** True when the customer has completed at least one order in their lifetime. */
  hasOrders: boolean;
}

/** Whether Shopify Email may send this customer marketing email. Not part of whether the claim is valid. */
export type EmailEligibility = "SUBSCRIBED" | "NOT_SUBSCRIBED" | "UNKNOWN";

export interface CustomerRecord {
  /** Customer GID */
  id: string;
  emailEligibility: EmailEligibility;
  /** The customer already carried the claim tag before this attempt, so adding it will not start Flow. */
  alreadyTagged: boolean;
}

export interface CustomerGateway {
  /**
   * Finds the Shopify customer by email or creates it. Marketing consent is only ever granted
   * from the popup's explicit checkbox (`marketingConsent`), and only to a customer who has not
   * made a choice; an existing choice, including an unsubscribe, is never overridden.
   */
  findOrCreate(input: { email: string; marketingConsent: boolean }): Promise<CustomerRecord>;
  /**
   * Read-only lookup for the first-purchase gate. Null when no Shopify customer exists for
   * this email yet, which is itself proof the address has never ordered.
   */
  findExisting(input: { email: string }): Promise<ExistingCustomer | null>;
  /**
   * Writes the trekiva.* metafields Flow reads. An upsert, so safe to repeat.
   * Throws on any failure: the claim must not be handed to Flow without them.
   */
  writeClaimMetafields(input: {
    customerId: string;
    discountCode: string;
    claimedAt: Date;
    campaignId: string;
    claimId: string;
  }): Promise<void>;
  /** Adds the trekiva_welcome_claimed tag without touching other tags. Idempotent; throws on failure. */
  addClaimTag(input: { customerId: string }): Promise<void>;
}

export interface DiscountCodeGateway {
  /** Adds `code` to the Shopify discount; resolves once it is redeemable. Idempotent. */
  issueCode(input: { discountId: string; code: string }): Promise<void>;
}

export class CampaignUnavailableError extends Error {}
export class InvalidEmailError extends Error {}
