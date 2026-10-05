import type { EmailContent } from "../email/template";

export type ClaimStatus = "claimed" | "already_claimed";

export interface ClaimOutcome {
  status: ClaimStatus;
  message: string;
}

export interface ClaimContext {
  shopDomain: string;
  campaignId: string;
  email: string;
}

export interface FulfilmentInput {
  /** The claim row's id, used as the send's idempotency key. */
  claimId: string;
  shopDomain: string;
  email: string;
  /** The merchant's internal label for the popup. Never shown to the customer. */
  campaignName: string;
  discountCode: string;
  claimedAt: Date;
  customerId: string;
  /** The campaign's editable email copy. */
  emailContent: EmailContent;
}

export interface CustomerRecord {
  /** Customer GID */
  id: string;
  /** False when the customer cannot get marketing email (opted out, pending double opt-in, invalid). */
  subscribed: boolean;
}

export interface CustomerGateway {
  /**
   * Finds the Shopify customer by email or creates it. Customers who never chose an email
   * marketing state are subscribed (the popup submission is the opt-in); others are left as is.
   */
  findOrCreate(input: { email: string }): Promise<CustomerRecord>;
  /** Best-effort mirror into trekiva.* customer metafields. Must not throw. */
  writeClaimMetafields(input: {
    customerId: string;
    discountCode: string;
    claimedAt: Date;
  }): Promise<void>;
}

export interface DiscountCodeGateway {
  /** Adds `code` to the Shopify discount; resolves once it is redeemable. Idempotent. */
  issueCode(input: { discountId: string; code: string }): Promise<void>;
}

/** Delivers the claim's discount code to the customer. */
export interface EmailGateway {
  sendWelcomeOffer(input: FulfilmentInput): Promise<void>;
}

export class CampaignUnavailableError extends Error {}
export class InvalidEmailError extends Error {}
