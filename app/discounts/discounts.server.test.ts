import { describe, expect, it } from "vitest";
import { toDiscountSummary } from "./discounts.server";

/** A WELCOME10 node as the Admin API returns it, with the fields each test varies. */
function node(discount: Record<string, unknown> = {}) {
  return {
    id: "gid://shopify/DiscountCodeNode/1",
    discount: {
      __typename: "DiscountCodeBasic",
      title: "Welcome 10%",
      status: "ACTIVE",
      startsAt: "2026-01-01T00:00:00Z",
      endsAt: null,
      appliesOncePerCustomer: true,
      usageLimit: 1,
      codes: { nodes: [{ code: "WELCOME10" }] },
      customerGets: { value: { __typename: "DiscountPercentage", percentage: 0.1 } },
      minimumRequirement: null,
      context: { __typename: "DiscountBuyerSelectionAll" },
      ...discount,
    },
  };
}

const summary = (d?: Record<string, unknown>) => toDiscountSummary(node(d))!;
const matching = (list: string[], re: RegExp) => list.filter((s) => re.test(s));

describe("toDiscountSummary", () => {
  it("maps the recommended WELCOME10 setup with no warnings", () => {
    expect(summary()).toMatchObject({
      code: "WELCOME10",
      valueLabel: "10% off",
      isPercentage: true,
      oncePerCustomer: true,
      usageLimit: 1,
      eligibility: "All customers",
      minimumRequirement: "None",
      warnings: [],
      notes: [],
    });
  });

  it("suggests a per-code usage limit of 1 without calling it a cap on the campaign", () => {
    const { notes, warnings } = summary({ usageLimit: null });
    expect(warnings).toEqual([]);
    const note = matching(notes, /used in total/)[0];
    expect(note).toBeDefined();
    // The old copy implied this capped the whole discount; it must say the opposite.
    expect(note).toMatch(/each code/i);
    expect(note).toMatch(/does not cap/i);
    expect(note).toMatch(/unlimited/i);
  });

  it("warns when one use per customer is off, because that is what stops code reuse", () => {
    const { warnings } = summary({ appliesOncePerCustomer: false });
    expect(matching(warnings, /one use per customer/i)).toHaveLength(1);
  });

  it("never tells the merchant to limit total usage as a requirement", () => {
    for (const usageLimit of [null, 1, 5]) {
      const { warnings } = summary({ usageLimit });
      expect(matching(warnings, /used in total/)).toHaveLength(0);
    }
  });

  it("still reports the real problems", () => {
    expect(matching(summary({ status: "EXPIRED" }).warnings, /expired/i)).toHaveLength(1);
    expect(matching(summary({ status: "SCHEDULED" }).warnings, /scheduled/i)).toHaveLength(1);
    expect(
      matching(summary({ context: { __typename: "DiscountCustomers" } }).warnings, /specific customers/i),
    ).toHaveLength(1);
    expect(
      matching(
        summary({ customerGets: { value: { __typename: "DiscountAmount", amount: { amount: "5.0", currencyCode: "INR" } } } }).warnings,
        /not a percentage/i,
      ),
    ).toHaveLength(1);
  });

  it("ignores discounts it cannot support", () => {
    expect(toDiscountSummary({ id: "x", discount: { __typename: "DiscountCodeBxgy" } })).toBeNull();
    expect(toDiscountSummary(node({ codes: { nodes: [] } }))).toBeNull();
  });
});
