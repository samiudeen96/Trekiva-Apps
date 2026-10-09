/** Which fulfilment step a failed claim stopped at (legacy rows may also hold "flow"). */
export type ClaimFailureStep = "customer" | "discount" | "metafields" | "tag" | "email";

export type ClaimStatus = "claimed" | "already_claimed" | "not_eligible";

export interface ClaimOutcome {
  status: ClaimStatus;
  message: string;
  /** Overrides the popup's title for this outcome (instant apply has its own wording). */
  title?: string;
  /**
   * Instant apply only: the store path ("/discount/CODE") the popup opens in the background to apply
   * the discount. Present only on the request that created or completed the claim, never for an
   * email that already claimed, or anyone could read another person's code by typing their address.
   */
  applyPath?: string;
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
  /** For the email greeting; null when Shopify has none (a customer created from just an email). */
  firstName?: string | null;
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
  /**
   * Adds the trekiva_welcome_claimed tag without touching other tags. Idempotent; throws on failure.
   * `restart` first removes our own tag if present: Flow only starts when the tag is ADDED, so a customer
   * who still carries it from an earlier (deleted) claim would otherwise never be emailed.
   */
  addClaimTag(input: { customerId: string; restart?: boolean }): Promise<void>;
}

export interface DiscountCodeGateway {
  /** Adds `code` to the Shopify discount; resolves once it is redeemable. Idempotent. */
  issueCode(input: { discountId: string; code: string }): Promise<void>;
}

export interface WelcomeEmailInput {
  claimId: string;
  shopDomain: string;
  email: string;
  customerId: string;
  firstName: string | null;
  discountCode: string;
  /** SUBSCRIBED gets the merchant's template; anyone else gets only their code. */
  emailEligibility: EmailEligibility;
  template: import("../email/schema").EmailTemplate;
}

/** Sends the claim's email itself (Resend). Absent when the merchant has not configured it. */
export interface EmailGateway {
  /** Idempotent per claim; throws on any failure so the claim can be retried. */
  sendWelcomeOffer(input: WelcomeEmailInput): Promise<void>;
}

export class CampaignUnavailableError extends Error {}
export class InvalidEmailError extends Error {}
