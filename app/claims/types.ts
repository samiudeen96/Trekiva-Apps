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
  shopDomain: string;
  email: string;
  campaignName: string;
  discountCode: string;
  claimedAt: Date;
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

/** Fires the "Welcome Offer Claimed" Flow trigger. */
export interface FlowGateway {
  triggerWelcomeOfferClaimed(
    input: FulfilmentInput & { customerId: string },
  ): Promise<void>;
}

export class CampaignUnavailableError extends Error {}
export class InvalidEmailError extends Error {}
