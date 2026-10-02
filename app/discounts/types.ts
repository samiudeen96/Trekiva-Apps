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
  minimumRequirement: string;
  eligibility: string;
  /** Merchant-facing issues; they never block saving (except expiry, see service). */
  warnings: string[];
}

export interface AdminGraphqlClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}
