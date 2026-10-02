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

export interface CustomerGateway {
  /** Finds the Shopify customer by email or creates it; returns its GID. */
  findOrCreate(input: { email: string }): Promise<string>;
  /** Best-effort mirror into trekiva.* customer metafields. Must not throw. */
  writeClaimMetafields(input: {
    customerId: string;
    discountCode: string;
    claimedAt: Date;
  }): Promise<void>;
}

/** Fires the "Welcome Offer Claimed" Flow trigger. */
export interface FlowGateway {
  triggerWelcomeOfferClaimed(
    input: FulfilmentInput & { customerId: string },
  ): Promise<void>;
}

export class CampaignUnavailableError extends Error {}
export class InvalidEmailError extends Error {}
