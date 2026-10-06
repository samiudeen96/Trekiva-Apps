import { describe, expect, it } from "vitest";
import { checkCampaignDiscounts, missingScopes } from "./health.server";

const required = ["read_customers", "write_customers", "read_discounts", "write_discounts"];

describe("missingScopes", () => {
  it("treats a granted write scope as covering its read scope", () => {
    expect(missingScopes(required, "write_customers,write_discounts")).toEqual([]);
  });

  it("reports scopes that are really missing", () => {
    expect(missingScopes(required, "write_customers,read_discounts")).toEqual(["write_discounts"]);
    expect(missingScopes(required, undefined)).toEqual(required);
  });
});

describe("checkCampaignDiscounts", () => {
  const live = async () => ({ status: "ACTIVE" as const });
  const camp = (name: string, discountId: string | null = "gid://shopify/DiscountCodeNode/1") => ({ name, discountId });

  it("is fine with no active campaigns", async () => {
    expect(await checkCampaignDiscounts([], live)).toEqual({ ok: true, detail: "No active campaigns" });
  });

  it("passes when every active campaign's discount is live", async () => {
    const r = await checkCampaignDiscounts([camp("A"), camp("B")], live);
    expect(r.ok).toBe(true);
    expect(r.detail).toContain("2 active campaign(s)");
  });

  it("flags a deleted discount, naming the campaign", async () => {
    const r = await checkCampaignDiscounts([camp("Welcome")], async () => null);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('"Welcome": its discount no longer exists in Shopify');
  });

  it("flags expired and not-yet-started discounts", async () => {
    const status = { x: "EXPIRED", y: "SCHEDULED" } as const;
    const r = await checkCampaignDiscounts(
      [camp("Old", "x"), camp("Soon", "y")],
      async (id) => ({ status: status[id as "x" | "y"] }),
    );
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("has expired");
    expect(r.detail).toContain("has not started yet");
  });

  it("flags a campaign with no discount without calling Shopify", async () => {
    let calls = 0;
    const r = await checkCampaignDiscounts([camp("Bare", null)], async () => {
      calls += 1;
      return { status: "ACTIVE" };
    });
    expect(r.ok).toBe(false);
    expect(calls).toBe(0);
  });

  it("reports a lookup error as a problem instead of throwing", async () => {
    const r = await checkCampaignDiscounts([camp("A")], async () => {
      throw new Error("shopify down");
    });
    expect(r).toEqual({ ok: false, detail: '"A": could not check its discount' });
  });
});
