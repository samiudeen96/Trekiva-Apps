import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import db from "../db.server";
import { ClaimService } from "./claim.service";

// Lets a test force the next generated code, so a suffix collision can be reproduced.
const forced = vi.hoisted(() => ({ codes: [] as string[] }));
vi.mock("../discounts/redeem-codes.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../discounts/redeem-codes.server")>();
  return {
    ...actual,
    generateClaimCode: (base: string) => forced.codes.shift() ?? actual.generateClaimCode(base),
  };
});

import {
  InvalidEmailError,
  type CustomerGateway,
  type DiscountCodeGateway,
  type EmailEligibility,
} from "./types";

const shop = `claim-test-${Date.now()}.myshopify.com`;
const DISCOUNT_ID = "gid://shopify/DiscountCodeNode/1";
const CUSTOMER_ID = "gid://shopify/Customer/1";
const CLAIM_CODE = /^WELCOME10-[A-Z2-9]{8}$/;
let campaignId: string;

const content = {
  successMessage: "Check your inbox for your 10% welcome offer.",
  alreadyClaimedMessage:
    "You’ve already claimed your welcome offer. Please check your previous email for your discount code.",
  notEligibleMessage: "This welcome offer is available for first-time customers only.",
};

type Hook = () => Promise<unknown> | unknown;

function build(
  overrides: {
    issueCode?: Hook;
    metafields?: Hook;
    tag?: Hook;
    eligibility?: EmailEligibility;
    alreadyTagged?: boolean;
    /** What the first-purchase gate sees; undefined = no Shopify customer for this email yet. */
    existing?: { id: string; hasOrders: boolean };
  } = {},
) {
  /** Every Shopify write, in the order it happened. */
  const order: string[] = [];
  const findOrCreate = vi.fn<CustomerGateway["findOrCreate"]>(async () => {
    order.push("customer");
    return {
      id: CUSTOMER_ID,
      emailEligibility: overrides.eligibility ?? "SUBSCRIBED",
      alreadyTagged: overrides.alreadyTagged ?? false,
    };
  });
  const findExisting = vi.fn<CustomerGateway["findExisting"]>(async () => overrides.existing ?? null);
  const issueCode = vi.fn<DiscountCodeGateway["issueCode"]>(async () => {
    order.push("discount");
    await overrides.issueCode?.();
  });
  const writeClaimMetafields = vi.fn<CustomerGateway["writeClaimMetafields"]>(async () => {
    order.push("metafields");
    await overrides.metafields?.();
  });
  const addClaimTag = vi.fn<CustomerGateway["addClaimTag"]>(async () => {
    order.push("tag");
    await overrides.tag?.();
  });
  const service = new ClaimService(
    { findOrCreate, findExisting, writeClaimMetafields, addClaimTag },
    { issueCode },
  );
  return { service, order, findOrCreate, findExisting, issueCode, writeClaimMetafields, addClaimTag };
}

/** Turns the first-purchase gate on for the campaign under test. */
const requireFirstPurchase = () =>
  db.campaign.update({ where: { id: campaignId }, data: { rules: { firstPurchaseOnly: true } } });

const claims = () => db.welcomeOfferClaim.findMany({ where: { shopDomain: shop } });
const only = () => db.welcomeOfferClaim.findFirstOrThrow({ where: { shopDomain: shop } });
const claim = (service: ClaimService, email: string, marketingConsent?: boolean) =>
  service.claim({ shopDomain: shop, campaignId, email, marketingConsent });

beforeEach(async () => {
  forced.codes = [];
  await db.welcomeOfferClaim.deleteMany({ where: { shopDomain: shop } });
  await db.campaign.deleteMany({ where: { shopDomain: shop } });
  const c = await db.campaign.create({
    data: {
      shopDomain: shop,
      name: "Welcome 10% Popup",
      status: "ACTIVE",
      discountId: DISCOUNT_ID,
      discountCode: "WELCOME10",
      content,
      design: {},
      rules: {},
    },
  });
  campaignId = c.id;
});

afterAll(async () => {
  await db.welcomeOfferClaim.deleteMany({ where: { shopDomain: shop } });
  await db.campaign.deleteMany({ where: { shopDomain: shop } });
  await db.$disconnect();
});

describe("ClaimService: new eligible customer", () => {
  it("creates the claim, customer, code and metafields, then adds the tag last", async () => {
    const { service, order, issueCode, writeClaimMetafields, addClaimTag } = build();
    const out = await claim(service, "  Customer@Example.com ");
    expect(out).toEqual({ status: "claimed", message: content.successMessage });

    // The tag starts Flow, so everything Flow reads must already exist.
    expect(order).toEqual(["customer", "discount", "metafields", "tag"]);

    const row = await only();
    expect(row).toMatchObject({
      emailNormalized: "customer@example.com",
      discountCode: expect.stringMatching(CLAIM_CODE),
      shopifyCustomerId: CUSTOMER_ID,
      emailStatus: "READY_FOR_FLOW",
      emailEligibility: "SUBSCRIBED",
      failureStep: null,
      failureReason: null,
    });
    expect(row.flowHandoffAt).not.toBeNull();
    expect(issueCode).toHaveBeenCalledWith({ discountId: DISCOUNT_ID, code: row.discountCode });
    expect(writeClaimMetafields).toHaveBeenCalledWith({
      customerId: CUSTOMER_ID,
      discountCode: row.discountCode,
      claimedAt: row.claimedAt,
      campaignId,
      claimId: row.id,
    });
    expect(addClaimTag).toHaveBeenCalledWith({ customerId: CUSTOMER_ID });
  });

  it("every claim gets a different code", async () => {
    const { service } = build();
    await claim(service, "one@example.com");
    await claim(service, "two@example.com");
    const codes = (await claims()).map((r) => r.discountCode);
    expect(new Set(codes).size).toBe(2);
  });

  it("a customer who is not subscribed still gets a valid claim, flagged for the admin", async () => {
    const { service, addClaimTag } = build({ eligibility: "NOT_SUBSCRIBED" });
    expect((await claim(service, "optout@example.com")).status).toBe("claimed");
    expect(addClaimTag).toHaveBeenCalledTimes(1);
    expect(await only()).toMatchObject({ emailStatus: "READY_FOR_FLOW", emailEligibility: "NOT_SUBSCRIBED" });
    // Delivery eligibility never reopens the claim.
    expect((await claim(service, "optout@example.com")).status).toBe("already_claimed");
    expect(addClaimTag).toHaveBeenCalledTimes(1);
  });

  it("records unknown consent as UNKNOWN rather than guessing", async () => {
    const { service } = build({ eligibility: "UNKNOWN" });
    await claim(service, "who@example.com");
    expect((await only()).emailEligibility).toBe("UNKNOWN");
  });

  it("stores the popup's explicit marketing consent, and defaults to none", async () => {
    const { service, findOrCreate } = build();
    await claim(service, "yes@example.com", true);
    await claim(service, "no@example.com");
    expect(findOrCreate).toHaveBeenNthCalledWith(1, { email: "yes@example.com", marketingConsent: true });
    expect(findOrCreate).toHaveBeenNthCalledWith(2, { email: "no@example.com", marketingConsent: false });
    const rows = await claims();
    expect(rows.find((r) => r.emailNormalized === "yes@example.com")?.marketingConsent).toBe(true);
    expect(rows.find((r) => r.emailNormalized === "no@example.com")?.marketingConsent).toBe(false);
  });
});

describe("ClaimService: duplicate protection", () => {
  it("same email (any casing or padding) is already_claimed: no second code, tag or customer lookup", async () => {
    const { service, addClaimTag, issueCode, findOrCreate, writeClaimMetafields } = build();
    await claim(service, "a@b.co");
    for (const email of [" A@B.CO", "a@B.co ", "A@b.Co"]) {
      expect(await claim(service, email)).toEqual({
        status: "already_claimed",
        message: content.alreadyClaimedMessage,
      });
    }
    expect(addClaimTag).toHaveBeenCalledTimes(1);
    expect(issueCode).toHaveBeenCalledTimes(1);
    expect(findOrCreate).toHaveBeenCalledTimes(1);
    expect(writeClaimMetafields).toHaveBeenCalledTimes(1);
    expect(await db.welcomeOfferClaim.count({ where: { shopDomain: shop } })).toBe(1);
  });

  it("25 concurrent submissions produce one claim, one code and one tag", async () => {
    const { service, addClaimTag, issueCode } = build({ tag: () => new Promise((r) => setTimeout(r, 50)) });
    const results = await Promise.all(Array.from({ length: 25 }, () => claim(service, "race@example.com")));
    expect(results.filter((r) => r.status === "claimed")).toHaveLength(1);
    expect(results.filter((r) => r.status === "already_claimed")).toHaveLength(24);
    expect(addClaimTag).toHaveBeenCalledTimes(1);
    expect(issueCode).toHaveBeenCalledTimes(1);
    expect(await db.welcomeOfferClaim.count({ where: { shopDomain: shop } })).toBe(1);
  });

  it("concurrent case variants of one email still make one claim", async () => {
    const { service, addClaimTag } = build({ tag: () => new Promise((r) => setTimeout(r, 30)) });
    const emails = ["Mix@Example.com", "mix@example.com", " MIX@EXAMPLE.COM", "mix@example.com "];
    const results = await Promise.all(emails.map((e) => claim(service, e)));
    expect(results.filter((r) => r.status === "claimed")).toHaveLength(1);
    expect(addClaimTag).toHaveBeenCalledTimes(1);
    expect(await db.welcomeOfferClaim.count({ where: { shopDomain: shop } })).toBe(1);
  });

  it("a different email can still claim", async () => {
    const { service, addClaimTag } = build();
    await claim(service, "one@example.com");
    expect((await claim(service, "two@example.com")).status).toBe("claimed");
    expect(addClaimTag).toHaveBeenCalledTimes(2);
  });

  it("a claim settled by the old Flow trigger is never fulfilled again", async () => {
    const { service, findOrCreate, addClaimTag } = build();
    await db.welcomeOfferClaim.create({
      data: {
        shopDomain: shop,
        campaignId,
        emailNormalized: "legacy@example.com",
        discountCode: "WELCOME10-LEGACY22",
        emailStatus: "FAILED",
        flowTriggeredAt: new Date(),
      },
    });
    expect((await claim(service, "legacy@example.com")).status).toBe("already_claimed");
    expect(findOrCreate).not.toHaveBeenCalled();
    expect(addClaimTag).not.toHaveBeenCalled();
  });
});

describe("ClaimService: Shopify failures and retry", () => {
  it("a failed code issue stops before metafields and the tag, and records the step", async () => {
    const { service, writeClaimMetafields, addClaimTag } = build({
      issueCode: () => {
        throw new Error("discounts down");
      },
    });
    await expect(claim(service, "y@example.com")).rejects.toThrow("discounts down");
    expect(writeClaimMetafields).not.toHaveBeenCalled();
    expect(addClaimTag).not.toHaveBeenCalled();
    expect(await only()).toMatchObject({
      emailStatus: "FAILED",
      failureStep: "discount",
      failureReason: "discounts down",
      flowHandoffAt: null,
    });
  });

  it("a customer failure is recorded and nothing else runs", async () => {
    const { service, findOrCreate, issueCode } = build();
    findOrCreate.mockRejectedValueOnce(new Error("customers down"));
    await expect(claim(service, "c@example.com")).rejects.toThrow();
    expect(issueCode).not.toHaveBeenCalled();
    expect((await only()).failureStep).toBe("customer");
  });

  it("a metafield failure keeps the code, adds NO tag, and the retry reuses the same code", async () => {
    let fail = true;
    const { service, order, issueCode, addClaimTag } = build({
      metafields: () => {
        if (fail) throw new Error("metafieldsSet failed: bad value");
      },
    });
    await expect(claim(service, "m@example.com")).rejects.toThrow();
    expect(addClaimTag).not.toHaveBeenCalled();
    const failed = await only();
    expect(failed).toMatchObject({ emailStatus: "FAILED", failureStep: "metafields", flowHandoffAt: null });

    fail = false;
    order.length = 0;
    expect((await claim(service, "m@example.com")).status).toBe("claimed");
    expect(issueCode).toHaveBeenLastCalledWith({ discountId: DISCOUNT_ID, code: failed.discountCode });
    expect(order).toEqual(["customer", "discount", "metafields", "tag"]);
    const ok = await only();
    expect(ok.discountCode).toBe(failed.discountCode);
    expect(ok).toMatchObject({ emailStatus: "READY_FOR_FLOW", failureStep: null, failureReason: null });
    expect(await db.welcomeOfferClaim.count({ where: { shopDomain: shop } })).toBe(1);
    expect(addClaimTag).toHaveBeenCalledTimes(1);
  });

  it("a tag failure keeps the code and metafields, and the retry completes with the same code", async () => {
    let fail = true;
    const { service, writeClaimMetafields, issueCode, addClaimTag } = build({
      tag: () => {
        if (fail) throw new Error("tagsAdd failed");
      },
    });
    await expect(claim(service, "t@example.com")).rejects.toThrow();
    const failed = await only();
    expect(failed).toMatchObject({ emailStatus: "FAILED", failureStep: "tag", flowHandoffAt: null });
    expect(writeClaimMetafields).toHaveBeenCalledTimes(1);

    fail = false;
    expect((await claim(service, "t@example.com")).status).toBe("claimed");
    expect(addClaimTag).toHaveBeenCalledTimes(2);
    // The same code both times: no second code was ever created.
    expect(issueCode.mock.calls.map(([a]) => a.code)).toEqual([failed.discountCode, failed.discountCode]);
    const ok = await only();
    expect(ok.discountCode).toBe(failed.discountCode);
    expect(ok.flowHandoffAt).not.toBeNull();
  });

  it("a customer who already has the tag still completes (tagsAdd is a no-op)", async () => {
    const { service, addClaimTag } = build({ alreadyTagged: true });
    expect((await claim(service, "tagged@example.com")).status).toBe("claimed");
    expect(addClaimTag).toHaveBeenCalledTimes(1);
    expect((await only()).emailStatus).toBe("READY_FOR_FLOW");
  });

  it("a lost response after everything succeeded is retried with identical, idempotent writes", async () => {
    let lose = true;
    const { service, order, writeClaimMetafields, addClaimTag } = build({
      // The tag really lands in Shopify, but the response never reaches the app.
      tag: () => {
        if (lose) throw new Error("socket hang up");
      },
    });
    await expect(claim(service, "lost@example.com")).rejects.toThrow("socket hang up");
    expect(order).toEqual(["customer", "discount", "metafields", "tag"]);

    lose = false;
    expect((await claim(service, "lost@example.com")).status).toBe("claimed");

    // Same payload both times, so the upserts change nothing.
    expect(writeClaimMetafields.mock.calls[0][0]).toEqual(writeClaimMetafields.mock.calls[1][0]);
    expect(addClaimTag.mock.calls[0][0]).toEqual(addClaimTag.mock.calls[1][0]);
    expect(await db.welcomeOfferClaim.count({ where: { shopDomain: shop } })).toBe(1);
    expect((await only()).emailStatus).toBe("READY_FOR_FLOW");
  });

  it("a retry reuses the consent given at the original submission", async () => {
    let fail = true;
    const { service, findOrCreate } = build({
      issueCode: () => {
        if (fail) throw new Error("down");
      },
    });
    await expect(claim(service, "consent@example.com", true)).rejects.toThrow();
    fail = false;
    // The retry arrives without the checkbox (e.g. the admin "Retry" button).
    await claim(service, "consent@example.com", false);
    expect(findOrCreate).toHaveBeenLastCalledWith({ email: "consent@example.com", marketingConsent: true });
  });

  it("a failed claim can be retried exactly once even under concurrency", async () => {
    let fail = true;
    const { service, addClaimTag } = build({
      tag: () => {
        if (fail) throw new Error("tag down");
      },
    });
    await expect(claim(service, "x@example.com")).rejects.toThrow();
    expect((await only()).emailStatus).toBe("FAILED");

    fail = false;
    const results = await Promise.all(Array.from({ length: 5 }, () => claim(service, "x@example.com")));
    expect(results.filter((r) => r.status === "claimed")).toHaveLength(1);
    expect(addClaimTag).toHaveBeenCalledTimes(2); // 1 failed + 1 successful retry
    expect(await db.welcomeOfferClaim.count({ where: { shopDomain: shop } })).toBe(1);

    expect((await claim(service, "x@example.com")).status).toBe("already_claimed");
    expect(addClaimTag).toHaveBeenCalledTimes(2);
  });

  it("a duplicate code is regenerated on the initial claim, not mistaken for an already-claimed email", async () => {
    const { service, addClaimTag } = build();
    await claim(service, "first@example.com");
    const taken = (await only()).discountCode;

    // The next claim's first generated suffix collides with the code already issued.
    forced.codes = [taken];
    expect((await claim(service, "second@example.com")).status).toBe("claimed");
    expect(addClaimTag).toHaveBeenCalledTimes(2);

    const second = await db.welcomeOfferClaim.findFirstOrThrow({
      where: { shopDomain: shop, emailNormalized: "second@example.com" },
    });
    expect(second.discountCode).not.toBe(taken);
    expect(second.discountCode).toMatch(CLAIM_CODE);
  });

  it("the database rejects two claims sharing a code in one shop, but allows it across shops", async () => {
    const { service } = build();
    await claim(service, "owner@example.com");
    const row = await only();

    await expect(
      db.welcomeOfferClaim.create({
        data: { shopDomain: shop, campaignId, emailNormalized: "other@example.com", discountCode: row.discountCode },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    // Codes only have to be unique within the shop that issued them.
    const otherShop = `${shop}-sibling`;
    const sibling = await db.campaign.create({
      data: { shopDomain: otherShop, name: "C", status: "ACTIVE", discountCode: "W", content: {}, design: {}, rules: {} },
    });
    await expect(
      db.welcomeOfferClaim.create({
        data: { shopDomain: otherShop, campaignId: sibling.id, emailNormalized: "other@example.com", discountCode: row.discountCode },
      }),
    ).resolves.toBeTruthy();
    await db.welcomeOfferClaim.deleteMany({ where: { shopDomain: otherShop } });
    await db.campaign.deleteMany({ where: { shopDomain: otherShop } });
  });
});

describe("ClaimService: validation", () => {
  it("rejects invalid emails and inactive campaigns", async () => {
    const { service } = build();
    await expect(claim(service, "nope")).rejects.toBeInstanceOf(InvalidEmailError);
    await db.campaign.update({ where: { id: campaignId }, data: { status: "DISABLED" } });
    await expect(claim(service, "ok@example.com")).rejects.toThrow();
  });

  it("does not claim across shops", async () => {
    const { service } = build();
    await expect(
      service.claim({ shopDomain: "other.myshopify.com", campaignId, email: "ok@example.com" }),
    ).rejects.toThrow();
  });
});

describe("ClaimService: first-purchase eligibility", () => {
  it("a returning customer can claim while the rule is off, and order history is never read", async () => {
    const { service, findExisting } = build({ existing: { id: "gid://shopify/Customer/99", hasOrders: true } });
    expect((await claim(service, "regular@example.com")).status).toBe("claimed");
    expect(findExisting).not.toHaveBeenCalled();
  });

  it("refuses a customer who already has an order: no claim, code, metafields or tag", async () => {
    await requireFirstPurchase();
    const { service, order } = build({ existing: { id: "gid://shopify/Customer/99", hasOrders: true } });
    expect(await claim(service, "regular@example.com")).toEqual({
      status: "not_eligible",
      message: content.notEligibleMessage,
    });
    expect(order).toEqual([]);
    expect(await db.welcomeOfferClaim.count({ where: { shopDomain: shop } })).toBe(0);
  });

  it("lets an existing customer with no orders claim", async () => {
    await requireFirstPurchase();
    const { service, addClaimTag } = build({ existing: { id: "gid://shopify/Customer/5", hasOrders: false } });
    expect((await claim(service, "browser@example.com")).status).toBe("claimed");
    expect(addClaimTag).toHaveBeenCalledTimes(1);
  });

  it("lets a brand new email claim when Shopify has no customer for it", async () => {
    await requireFirstPurchase();
    const { service, findExisting } = build();
    expect((await claim(service, "brand@new.com")).status).toBe("claimed");
    expect(findExisting).toHaveBeenCalledWith({ email: "brand@new.com" });
  });

  it("refuses an ineligible email whatever the casing or padding", async () => {
    await requireFirstPurchase();
    const { service } = build({ existing: { id: "gid://shopify/Customer/99", hasOrders: true } });
    for (const email of ["Regular@Example.com", " REGULAR@EXAMPLE.COM "]) {
      expect((await claim(service, email)).status).toBe("not_eligible");
    }
    expect(await db.welcomeOfferClaim.count({ where: { shopDomain: shop } })).toBe(0);
  });

  it("gives every concurrent submission from an ineligible email the same answer", async () => {
    await requireFirstPurchase();
    const { service, addClaimTag } = build({ existing: { id: "gid://shopify/Customer/99", hasOrders: true } });
    const results = await Promise.all(Array.from({ length: 10 }, () => claim(service, "race-regular@example.com")));
    expect(results.every((r) => r.status === "not_eligible")).toBe(true);
    expect(addClaimTag).not.toHaveBeenCalled();
    expect(await db.welcomeOfferClaim.count({ where: { shopDomain: shop } })).toBe(0);
  });

  it("does not revoke an existing claim when the customer orders before a retry", async () => {
    await requireFirstPurchase();
    let fail = true;
    const { service, findExisting } = build({
      tag: () => {
        if (fail) throw new Error("tag down");
      },
    });
    await expect(claim(service, "ordered@example.com")).rejects.toThrow();

    // The customer completes an order between the failed attempt and the retry.
    findExisting.mockResolvedValue({ id: "gid://shopify/Customer/7", hasOrders: true });
    fail = false;
    expect((await claim(service, "ordered@example.com")).status).toBe("claimed");
  });
});
