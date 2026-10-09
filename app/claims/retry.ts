import type { ClaimOutcome } from "./types";

export interface RetryResult {
  /** Failed claims that were attempted. */
  attempted: number;
  /** Claims that now have their email triggered. */
  succeeded: number;
  /** Claims that failed again; their new reason is stored on the claim. */
  failed: number;
  /** Claims another request was already retrying, or that were settled meanwhile. */
  skipped: number;
  /**
   * Instant-apply claims (no email) that were left alone: the discount is applied in the customer's own
   * browser when they submit, so a retry from the admin would mark them done with nothing ever reaching
   * the customer. They are completed when that customer submits the popup again.
   */
  needsCustomer: number;
}

/**
 * Re-runs failed claims through the normal claim path, one at a time so Shopify's rate limits are
 * respected. Going through ClaimService keeps every guard: the compare-and-set that lets exactly one
 * request retry, the reused code, and no second email once Flow has been triggered.
 */
export async function retryClaims(
  rows: { campaignId: string; emailNormalized: string; delivery?: string }[],
  claim: (input: { campaignId: string; email: string }) => Promise<ClaimOutcome>,
): Promise<RetryResult> {
  const result: RetryResult = { attempted: 0, succeeded: 0, failed: 0, skipped: 0, needsCustomer: 0 };
  for (const row of rows) {
    if (row.delivery === "INSTANT") {
      result.needsCustomer += 1;
      continue;
    }
    result.attempted += 1;
    try {
      const out = await claim({ campaignId: row.campaignId, email: row.emailNormalized });
      if (out.status === "claimed") result.succeeded += 1;
      else result.skipped += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}
