export interface DiscountSummary {
  /** DiscountCodeNode GID */
  id: string;
  code: string;
  title: string;
  /** e.g. "10% off" */
  valueLabel: string;
  isPercentage: boolean;
  status: "ACTIVE" | "EXPIRED" | "SCHEDULED";
  startsAt: string | null;
  endsAt: string | null;
  oncePerCustomer: boolean;
  /** Uses allowed per redeem code (Shopify applies it per code, not per discount); null = unlimited. */
  usageLimit: number | null;
  minimumRequirement: string;
  eligibility: string;
  /** Names of the customer segments this discount is limited to; empty unless eligibility is segments. */
  segmentNames: string[];
  /** Merchant-facing issues; they never block saving (except expiry, see service). */
  warnings: string[];
  /** Optional setup advice. Not a problem, so it is shown in a calmer tone than a warning. */
  notes: string[];
}

export interface AdminGraphqlClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}
