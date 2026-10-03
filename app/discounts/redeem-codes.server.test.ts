import { describe, expect, it, vi } from "vitest";
import { ADD_CODE, BULK_STATUS, FIND_CODE, createDiscountCodeGateway, generateClaimCode } from "./redeem-codes.server";

const DISCOUNT_ID = "gid://shopify/DiscountCodeNode/1";
const input = { discountId: DISCOUNT_ID, code: "WELCOME10-ABCDEFGH" };

/** Fake Admin client: answers each operation from `responses`, in call order per operation. */
function admin(responses: Record<string, object[]>) {
  return {
    graphql: vi.fn(async (query: string) => {
      const key = Object.keys(responses).find((k) => query === k)!;
      return Response.json({ data: responses[key].shift() });
    }),
  };
}

const notFound = { codeDiscountNodeByCode: null };
const added = { discountRedeemCodeBulkAdd: { bulkCreation: { id: "gid://shopify/DiscountRedeemCodeBulkCreation/9" }, userErrors: [] } };
const status = (done: boolean, importedCount: number, errors: object[] = []) => ({
  discountRedeemCodeBulkCreation: { done, importedCount, codes: { nodes: [{ errors }] } },
});
const fast = { pollMs: 0, maxPolls: 3 };

describe("generateClaimCode", () => {
  it("keeps a readable prefix and adds an unambiguous random suffix", () => {
    expect(generateClaimCode("Welcome 10%")).toMatch(/^WELCOME10-[A-HJKMNP-Z2-9]{8}$/);
    expect(generateClaimCode("مرحبا")).toMatch(/^WELCOME-[A-Z2-9]{8}$/);
    expect(new Set(Array.from({ length: 50 }, () => generateClaimCode("W"))).size).toBe(50);
  });
});

describe("discount code gateway", () => {
  it("adds the code and waits until Shopify has imported it", async () => {
    const a = admin({ [FIND_CODE]: [notFound], [ADD_CODE]: [added], [BULK_STATUS]: [status(false, 0), status(true, 1)] });
    await createDiscountCodeGateway(a, fast).issueCode(input);
    const add = a.graphql.mock.calls.find(([q]) => q === ADD_CODE) as unknown as [string, { variables: object }];
    expect(add[1].variables).toEqual({ discountId: DISCOUNT_ID, codes: [{ code: input.code }] });
    expect(a.graphql.mock.calls.filter(([q]) => q === BULK_STATUS)).toHaveLength(2);
  });

  it("is a no-op when the code already exists (retried claim)", async () => {
    const a = admin({ [FIND_CODE]: [{ codeDiscountNodeByCode: { id: DISCOUNT_ID } }] });
    await createDiscountCodeGateway(a, fast).issueCode(input);
    expect(a.graphql).toHaveBeenCalledTimes(1);
  });

  it("throws when Shopify rejects the code", async () => {
    const a = admin({
      [FIND_CODE]: [notFound],
      [ADD_CODE]: [added],
      [BULK_STATUS]: [status(true, 0, [{ message: "Code must be unique" }])],
    });
    await expect(createDiscountCodeGateway(a, fast).issueCode(input)).rejects.toThrow(/must be unique/);
  });

  it("throws on userErrors and when the job never finishes", async () => {
    const rejected = admin({
      [FIND_CODE]: [notFound],
      [ADD_CODE]: [{ discountRedeemCodeBulkAdd: { bulkCreation: null, userErrors: [{ message: "bad" }] } }],
    });
    await expect(createDiscountCodeGateway(rejected, fast).issueCode(input)).rejects.toThrow(/bad/);

    const slow = admin({
      [FIND_CODE]: [notFound],
      [ADD_CODE]: [added],
      [BULK_STATUS]: [status(false, 0), status(false, 0), status(false, 0)],
    });
    await expect(createDiscountCodeGateway(slow, fast).issueCode(input)).rejects.toThrow(/did not finish/);
  });
});
