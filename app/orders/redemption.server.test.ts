import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import db from "../db.server";
import type { AdminGraphqlClient } from "../discounts/types";
import { restoreCodesFromOrder, revokeCodesUsedByOrder } from "./redemption.server";

const shop = `redeem-${Date.now()}.myshopify.com`;
const DISCOUNT = "gid://shopify/DiscountCodeNode/1";
const OTHER_DISCOUNT = "gid://shopify/DiscountCodeNode/2";
const ORDER = "gid://shopify/Order/555";
const OURS = "WELCOME10-TS73UDMA";
let campaignId: string;

/** Records every call, and answers as Shopify would for `code` living on `ownerId`. */
function fakeAdmin(codes: Record<string, string> = { [OURS]: DISCOUNT }) {
  const calls: { op: string; variables: Record<string, unknown> }[] = [];
  const admin: AdminGraphqlClient = {
    graphql: async (query: string, options) => {
      const variables = options?.variables ?? {};
      const op = /Trekiva(\w+)/.exec(query)?.[1] ?? "unknown";
      calls.push({ op, variables });
      const code = String(variables.code ?? "");
      const owner = codes[code.toUpperCase()];
      const body = {
        RedeemCodeId: {
          codeDiscountNodeByCode: owner
            ? { id: owner, codeDiscount: { codes: { nodes: [{ id: "gid://shopify/DiscountRedeemCode/9", code }] } } }
            : null,
        },
        DeleteRedeemCodes: { discountCodeRedeemCodeBulkDelete: { job: { id: "j" }, userErrors: [] } },
        FindRedeemCode: { codeDiscountNodeByCode: owner ? { id: owner } : null },
        AddRedeemCode: {
          discountRedeemCodeBulkAdd: { bulkCreation: { id: "b" }, userErrors: [] },
        },
        RedeemCodeBulkStatus: {
          discountRedeemCodeBulkCreation: { done: true, importedCount: 1, codes: { nodes: [] } },
        },
      }[op];
      return new Response(JSON.stringify({ data: body ?? {} }));
    },
  };
  return { admin, calls, deleted: () => calls.filter((c) => c.op === "DeleteRedeemCodes") };
}

beforeAll(async () => {
  const campaign = await db.campaign.create({
    data: {
      shopDomain: shop,
      name: "C",
      status: "ACTIVE",
      discountCode: "WELCOME10",
      discountId: DISCOUNT,
      content: {},
      design: {},
      rules: {},
    },
  });
  campaignId = campaign.id;
});

afterEach(async () => {
  await db.welcomeOfferClaim.deleteMany({ where: { shopDomain: shop } });
});

afterAll(async () => {
  await db.campaign.deleteMany({ where: { shopDomain: shop } });
  await db.$disconnect();
});

const claim = (discountCode: string, extra: Record<string, unknown> = {}) =>
  db.welcomeOfferClaim.create({
    data: { shopDomain: shop, campaignId, emailNormalized: `${discountCode}@x.com`, discountCode, ...extra },
  });

const orderWith = (code: string) => ({
  admin_graphql_api_id: ORDER,
  discount_codes: [{ code }],
});

describe("revokeCodesUsedByOrder", () => {
  it("deletes the code an order used and records the order against the claim", async () => {
    const row = await claim(OURS);
    const { admin, deleted } = fakeAdmin();

    await revokeCodesUsedByOrder(admin, shop, orderWith(OURS));

    expect(deleted()).toHaveLength(1);
    expect(deleted()[0].variables).toMatchObject({ discountId: DISCOUNT });
    const after = await db.welcomeOfferClaim.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.redeemedOrderId).toBe(ORDER);
    expect(after.redeemedAt).not.toBeNull();
  });

  it("finds the code when the checkout app left it only in a note attribute", async () => {
    await claim(OURS);
    const { admin, deleted } = fakeAdmin();

    await revokeCodesUsedByOrder(admin, shop, {
      admin_graphql_api_id: ORDER,
      discount_codes: [],
      note_attributes: [{ name: "_codkDiscounts", value: `orderLevel:99.9|${OURS}` }],
    });

    expect(deleted()).toHaveLength(1);
  });

  it("never touches a code Trekiva did not issue", async () => {
    const { admin, calls } = fakeAdmin({ SUMMERSALE: DISCOUNT });

    await revokeCodesUsedByOrder(admin, shop, orderWith("SUMMER-SALE24"));

    // Not in our claims table, so Shopify is never even asked about it.
    expect(calls).toHaveLength(0);
  });

  it("never touches another shop's claim with the same code", async () => {
    await claim(OURS);
    const { admin, calls } = fakeAdmin();

    await revokeCodesUsedByOrder(admin, "someone-else.myshopify.com", orderWith(OURS));

    expect(calls).toHaveLength(0);
  });

  it("refuses to delete when the code now belongs to a different discount", async () => {
    await claim(OURS);
    const { admin, deleted } = fakeAdmin({ [OURS]: OTHER_DISCOUNT });

    await revokeCodesUsedByOrder(admin, shop, orderWith(OURS));

    expect(deleted()).toHaveLength(0);
  });

  it("is safe to repeat: a second delivery of the same webhook changes nothing", async () => {
    const row = await claim(OURS);
    const { admin, deleted } = fakeAdmin();

    await revokeCodesUsedByOrder(admin, shop, orderWith(OURS));
    await revokeCodesUsedByOrder(admin, shop, orderWith(OURS));

    expect(deleted()).toHaveLength(1);
    const after = await db.welcomeOfferClaim.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.redeemedOrderId).toBe(ORDER);
  });

  it("leaves a code alone once another order has spent it", async () => {
    await claim(OURS, { redeemedAt: new Date(), redeemedOrderId: "gid://shopify/Order/1" });
    const { admin, calls } = fakeAdmin();

    await revokeCodesUsedByOrder(admin, shop, orderWith(OURS));

    expect(calls).toHaveLength(0);
  });
});

describe("restoreCodesFromOrder", () => {
  it("puts the code back when the order that spent it is cancelled", async () => {
    const row = await claim(OURS, { redeemedAt: new Date(), redeemedOrderId: ORDER });
    const { admin, calls } = fakeAdmin({});

    await restoreCodesFromOrder(admin, shop, orderWith(OURS));

    expect(calls.some((c) => c.op === "AddRedeemCode")).toBe(true);
    const after = await db.welcomeOfferClaim.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.redeemedAt).toBeNull();
    expect(after.redeemedOrderId).toBeNull();
  });

  it("ignores a cancellation of some other order", async () => {
    await claim(OURS, { redeemedAt: new Date(), redeemedOrderId: "gid://shopify/Order/999" });
    const { admin, calls } = fakeAdmin({});

    await restoreCodesFromOrder(admin, shop, orderWith(OURS));

    expect(calls).toHaveLength(0);
  });
});
