import { describe, expect, it, vi } from "vitest";
import { retryClaims } from "./retry";
import type { ClaimOutcome } from "./types";

const rows = [
  { campaignId: "c1", emailNormalized: "a@x.co" },
  { campaignId: "c1", emailNormalized: "b@x.co" },
  { campaignId: "c2", emailNormalized: "c@x.co" },
];
const claimed: ClaimOutcome = { status: "claimed", message: "ok" };
const already: ClaimOutcome = { status: "already_claimed", message: "no" };

describe("retryClaims", () => {
  it("retries every row through the claim path with its stored email and campaign", async () => {
    const claim = vi.fn(async () => claimed);
    const r = await retryClaims(rows, claim);
    expect(claim.mock.calls).toEqual([
      [{ campaignId: "c1", email: "a@x.co" }],
      [{ campaignId: "c1", email: "b@x.co" }],
      [{ campaignId: "c2", email: "c@x.co" }],
    ]);
    expect(r).toEqual({ attempted: 3, succeeded: 3, failed: 0, skipped: 0, needsCustomer: 0 });
  });

  it("counts a failure without stopping the rest", async () => {
    const claim = vi.fn(async ({ email }: { email: string }) => {
      if (email === "b@x.co") throw new Error("still failing");
      return claimed;
    });
    expect(await retryClaims(rows, claim)).toEqual({ attempted: 3, succeeded: 2, failed: 1, skipped: 0, needsCustomer: 0 });
  });

  it("counts a claim someone else already settled as skipped, not failed", async () => {
    const claim = vi.fn(async ({ email }: { email: string }) => (email === "a@x.co" ? already : claimed));
    expect(await retryClaims(rows, claim)).toEqual({ attempted: 3, succeeded: 2, failed: 0, skipped: 1, needsCustomer: 0 });
  });

  it("leaves instant-apply claims for the customer, since nothing from the admin could reach them", async () => {
    const claim = vi.fn(async () => claimed);
    const r = await retryClaims([...rows, { campaignId: "c1", emailNormalized: "i@x.co", delivery: "INSTANT" }], claim);
    expect(claim).toHaveBeenCalledTimes(3);
    expect(claim.mock.calls.flat()).not.toContainEqual({ campaignId: "c1", email: "i@x.co" });
    expect(r).toEqual({ attempted: 3, succeeded: 3, failed: 0, skipped: 0, needsCustomer: 1 });
  });

  it("runs one at a time", async () => {
    let running = 0;
    let peak = 0;
    const claim = async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running -= 1;
      return claimed;
    };
    await retryClaims(rows, claim);
    expect(peak).toBe(1);
  });

  it("does nothing for no rows", async () => {
    expect(await retryClaims([], vi.fn())).toEqual({ attempted: 0, succeeded: 0, failed: 0, skipped: 0, needsCustomer: 0 });
  });
});
