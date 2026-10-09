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
  type EmailGateway,
} from "./types";
import { defaultEmail } from "../email/defaults";

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
    /** When true the app (not Shopify Flow) sends the email, through this fake Resend gateway. */
    appEmail?: boolean;
    sendEmail?: Hook;
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
  const sendWelcomeOffer = vi.fn<EmailGateway["sendWelcomeOffer"]>(async () => {
    order.push("email");
    await overrides.sendEmail?.();
  });
  const service = new ClaimService(
    { findOrCreate, findExisting, writeClaimMetafields, addClaimTag },
    { issueCode },
    overrides.appEmail ? { sendWelcomeOffer } : undefined,
  );
  return { service, order, findOrCreate, findExisting, issueCode, writeClaimMetafields, addClaimTag, sendWelcomeOffer };
}

/** Turns the first-purchase gate on for the campaign under test. */
const requireFirstPurchase = () =>
  db.campaign.update({ where: { id: campaignId }, data: { rules: { firstPurchaseOnly: true, applyOnSignup: false } } });

const claims = () => db.welcomeOfferClaim.findMany({ where: { shopDomain: shop } });
const only = () => db.welcomeOfferClaim.findFirstOrThrow({ where: { shopDomain: shop } });
const claim = (service: ClaimService, email: string, marketingConsent?: boolean) =>
  service.claim({ shopDomain: shop, campaignId, email, marketingConsent });

beforeEach(async () => {
  forced.codes = [];
  await db.welcomeOfferClaim.deleteMany({ where: { shopDomain: shop } });
  await db.campaign.deleteMany({ where: { shopDomain: shop } });
  await db.emailTemplate.deleteMany({ where: { shopDomain: shop } });
  const c = await db.campaign.create({
    data: {
      shopDomain: shop,
      name: "Welcome 10% Popup",
      status: "ACTIVE",
      discountId: DISCOUNT_ID,
      discountCode: "WELCOME10",
      content,
      design: {},
      rules: { applyOnSignup: false },
    },
  });
  campaignId = c.id;
});

afterAll(async () => {
  await db.welcomeOfferClaim.deleteMany({ where: { shopDomain: shop } });
  await db.campaign.deleteMany({ where: { shopDomain: shop } });
  await db.emailTemplate.deleteMany({ where: { shopDomain: shop } });
  await db.$disconnect();
});

/** Switches the campaign to instant apply, the way the merchant's checkbox does. */
const applyInstantly = (extra: Record<string, unknown> = {}) =>
  db.campaign.update({ where: { id: campaignId }, data: { rules: { applyOnSignup: true, emailCode: false, ...extra } } });

/** Instant apply AND the email with its Apply button. */
const applyAndEmail = (extra: Record<string, unknown> = {}) =>
  db.campaign.update({ where: { id: campaignId }, data: { rules: { applyOnSignup: true, emailCode: true, ...extra } } });

describe("ClaimService: instant apply", () => {
  it("hands back the code to apply, sends no email and adds no tag or metafields", async () => {
    await applyInstantly();
    const { service, order, sendWelcomeOffer, writeClaimMetafields, addClaimTag } = build({ appEmail: true });

    const out = await claim(service, "new@example.com");

    expect(out.status).toBe("claimed");
    const row = await only();
    expect(out.applyPath).toBe(`/discount/${row.discountCode}`);
    expect(row.discountCode).toMatch(CLAIM_CODE);
    // The customer is still created (so signing up subscribes them) and the code made redeemable,
    // but nothing is emailed and Flow is never involved.
    expect(order).toEqual(["customer", "discount"]);
    expect(sendWelcomeOffer).not.toHaveBeenCalled();
    expect(writeClaimMetafields).not.toHaveBeenCalled();
    expect(addClaimTag).not.toHaveBeenCalled();
    expect(row).toMatchObject({ delivery: "INSTANT", emailStatus: "APPLIED", emailSentAt: null });
  });

  it("uses the applied wording, not the 'check your inbox' wording", async () => {
    await applyInstantly();
    const out = await claim(build().service, "new@example.com");
    expect(out.title).toMatch(/applied/i);
    expect(out.message).toMatch(/applied/i);
    expect(out.message).not.toMatch(/inbox/i);
  });

  it("never returns the code to an email that already claimed", async () => {
    await applyInstantly();
    const { service } = build();
    await claim(service, "same@example.com");

    const again = await claim(service, "  SAME@example.com ");

    expect(again.status).toBe("already_claimed");
    expect(again.applyPath).toBeUndefined();
    expect(JSON.stringify(again)).not.toMatch(/WELCOME10-/);
    expect(await claims()).toHaveLength(1);
  });

  it("still refuses a returning customer when first-purchase is on", async () => {
    await applyInstantly({ firstPurchaseOnly: true });
    const { service, issueCode } = build({ existing: { id: CUSTOMER_ID, hasOrders: true } });

    const out = await claim(service, "back@example.com");

    expect(out.status).toBe("not_eligible");
    expect(out.applyPath).toBeUndefined();
    expect(issueCode).not.toHaveBeenCalled();
    expect(await claims()).toHaveLength(0);
  });

  it("gives out no code when Shopify could not add it, and the retry reuses the same one", async () => {
    await applyInstantly();
    let fail = true;
    const { service } = build({
      issueCode: () => {
        if (fail) throw new Error("shopify down");
      },
    });

    await expect(claim(service, "retry@example.com")).rejects.toThrow("shopify down");
    const failed = await only();
    expect(failed.emailStatus).toBe("FAILED");

    fail = false;
    const out = await claim(service, "retry@example.com");
    expect(out.applyPath).toBe(`/discount/${failed.discountCode}`);
    expect((await only()).emailStatus).toBe("APPLIED");
  });

  it("is settled after success: a later submit is just already-claimed", async () => {
    await applyInstantly();
    const { service, issueCode } = build();
    await claim(service, "once@example.com");
    issueCode.mockClear();

    const again = await claim(service, "once@example.com");

    expect(again.status).toBe("already_claimed");
    expect(issueCode).not.toHaveBeenCalled();
  });

  it("only one of many simultaneous submits for one email gets the code", async () => {
    await applyInstantly();
    const { service } = build();

    const outcomes = await Promise.all(Array.from({ length: 15 }, () => claim(service, "race@example.com")));

    expect(outcomes.filter((o) => o.applyPath)).toHaveLength(1);
    expect(await claims()).toHaveLength(1);
  });
});

describe("ClaimService: instant apply together with the email", () => {
  it("emails the apply button AND hands back the code to apply, with wording that says so", async () => {
    await applyAndEmail();
    const { service, order, sendWelcomeOffer, addClaimTag } = build({ appEmail: true });

    const out = await claim(service, "both@example.com");

    const row = await only();
    expect(out.applyPath).toBe(`/discount/${row.discountCode}`);
    expect(out.message).toMatch(/applied/i);
    expect(out.message).toMatch(/emailed/i);
    expect(out.message).not.toMatch(/WELCOME10-/);
    expect(out.title).toMatch(/applied/i);
    expect(sendWelcomeOffer).toHaveBeenCalledTimes(1);
    expect(sendWelcomeOffer.mock.calls[0][0].discountCode).toBe(row.discountCode);
    // The email is sent after the code is redeemable, and Flow is still not involved.
    expect(order.slice(0, 3)).toEqual(["customer", "discount", "email"]);
    expect(addClaimTag).not.toHaveBeenCalled();
    expect(row).toMatchObject({ delivery: "APP", emailStatus: "EMAIL_SENT" });
    expect(row.emailSentAt).not.toBeNull();
  });

  it("without a way to send email it falls back to instant apply alone", async () => {
    await applyAndEmail();
    const { service, sendWelcomeOffer } = build({ appEmail: false });

    const out = await claim(service, "noresend@example.com");

    expect(out.applyPath).toMatch(/^\/discount\/WELCOME10-/);
    expect(out.message).not.toMatch(/emailed/i);
    expect(sendWelcomeOffer).not.toHaveBeenCalled();
    expect((await only()).delivery).toBe("INSTANT");
  });

  it("gives out no code when the email fails, and the retry sends it and returns the same code", async () => {
    await applyAndEmail();
    let fail = true;
    const { service, sendWelcomeOffer } = build({
      appEmail: true,
      sendEmail: () => {
        if (fail) throw new Error("resend down");
      },
    });

    await expect(claim(service, "flaky@example.com")).rejects.toThrow("resend down");
    const failed = await only();
    expect(failed.emailStatus).toBe("FAILED");

    fail = false;
    const out = await claim(service, "flaky@example.com");
    expect(out.applyPath).toBe(`/discount/${failed.discountCode}`);
    expect(sendWelcomeOffer).toHaveBeenCalledTimes(2);
    expect((await only()).emailStatus).toBe("EMAIL_SENT");
  });

  it("never returns the code to an email that already claimed", async () => {
    await applyAndEmail();
    const { service, sendWelcomeOffer } = build({ appEmail: true });
    await claim(service, "dup@example.com");

    const again = await claim(service, "dup@example.com");

    expect(again.status).toBe("already_claimed");
    expect(again.applyPath).toBeUndefined();
    expect(sendWelcomeOffer).toHaveBeenCalledTimes(1);
  });

  it("with instant apply off, it is the original email-only flow and returns no apply path", async () => {
    await applyAndEmail({ applyOnSignup: false });
    const { service } = build({ appEmail: true });

    const out = await claim(service, "emailonly@example.com");

    expect(out).toEqual({ status: "claimed", message: content.successMessage });
  });
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
    expect(addClaimTag).toHaveBeenCalledWith({ customerId: CUSTOMER_ID, restart: false });
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

  it("a NEW claim for a customer who still has the tag re-adds it so Flow starts again", async () => {
    // e.g. the merchant deleted this customer's earlier claim, or they claimed another campaign.
    const { service, addClaimTag } = build({ alreadyTagged: true });
    expect((await claim(service, "tagged@example.com")).status).toBe("claimed");
    expect(addClaimTag).toHaveBeenCalledTimes(1);
    expect(addClaimTag).toHaveBeenCalledWith({ customerId: CUSTOMER_ID, restart: true });
    expect((await only()).emailStatus).toBe("READY_FOR_FLOW");
  });

  it("a RETRY never re-adds the tag: it may be ours from a lost response, and Flow already started", async () => {
    let fail = true;
    const { service, findOrCreate, addClaimTag } = build({
      tag: () => {
        if (fail) throw new Error("socket hang up");
      },
    });
    await expect(claim(service, "again@example.com")).rejects.toThrow();
    // The tag really landed in Shopify, so the retry's customer lookup now sees it.
    findOrCreate.mockResolvedValueOnce({ id: CUSTOMER_ID, emailEligibility: "SUBSCRIBED", alreadyTagged: true });
    fail = false;
    expect((await claim(service, "again@example.com")).status).toBe("claimed");
    expect(addClaimTag).toHaveBeenLastCalledWith({ customerId: CUSTOMER_ID, restart: false });
  });

  it("a deleted claim can be claimed again by the same email and still ends up handed to Flow", async () => {
    const { service, addClaimTag } = build();
    await claim(service, "redo@example.com");
    const first = await only();
    await db.welcomeOfferClaim.delete({ where: { id: first.id } });

    const second = build({ alreadyTagged: true });
    expect((await claim(second.service, "redo@example.com")).status).toBe("claimed");
    expect(second.addClaimTag).toHaveBeenCalledWith({ customerId: CUSTOMER_ID, restart: true });
    const row = await only();
    expect(row.id).not.toBe(first.id);
    expect(row.discountCode).not.toBe(first.discountCode);
    expect(row.emailStatus).toBe("READY_FOR_FLOW");
    expect(addClaimTag).toHaveBeenCalledTimes(1);
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
      data: { shopDomain: otherShop, name: "C", status: "ACTIVE", discountCode: "W", content: {}, design: {}, rules: { applyOnSignup: false } },
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

describe("ClaimService: email sent by the app", () => {
  it("sends the email once, adds NO Flow tag, and mirrors the metafields after", async () => {
    const { service, order, addClaimTag, sendWelcomeOffer } = build({ appEmail: true });
    expect((await claim(service, "App@Example.com")).status).toBe("claimed");

    expect(order).toEqual(["customer", "discount", "email", "metafields"]);
    expect(addClaimTag).not.toHaveBeenCalled(); // a Flow workflow left switched on must not send a second email
    const row = await only();
    expect(row).toMatchObject({ delivery: "APP", emailStatus: "EMAIL_SENT", failureStep: null, flowHandoffAt: null });
    expect(row.emailSentAt).not.toBeNull();
    expect(sendWelcomeOffer).toHaveBeenCalledWith({
      claimId: row.id,
      shopDomain: shop,
      email: "app@example.com",
      customerId: CUSTOMER_ID,
      firstName: null,
      discountCode: row.discountCode,
      emailEligibility: "SUBSCRIBED",
      template: defaultEmail,
    });
  });

  it("hands the gateway the customer's consent state, so it can send a code-only message", async () => {
    const { service, sendWelcomeOffer } = build({ appEmail: true, eligibility: "NOT_SUBSCRIBED" });
    await claim(service, "optout@example.com");
    expect(sendWelcomeOffer.mock.calls[0][0].emailEligibility).toBe("NOT_SUBSCRIBED");
    expect((await only()).emailStatus).toBe("EMAIL_SENT");
  });

  it("sends the template the campaign picked, including edits saved after it was picked", async () => {
    const tpl = await db.emailTemplate.create({
      data: { shopDomain: shop, name: "Custom", template: { ...defaultEmail, subject: "Custom {{shop_name}}" } },
    });
    await db.campaign.update({ where: { id: campaignId }, data: { emailTemplateId: tpl.id } });
    const { service, sendWelcomeOffer } = build({ appEmail: true });
    await claim(service, "t@example.com");
    expect(sendWelcomeOffer.mock.calls[0][0].template.subject).toBe("Custom {{shop_name}}");

    await db.emailTemplate.update({ where: { id: tpl.id }, data: { template: { ...defaultEmail, subject: "Edited" } } });
    await claim(service, "t2@example.com");
    expect(sendWelcomeOffer.mock.calls[1][0].template.subject).toBe("Edited");
  });

  it("a campaign saved before templates existed gets the default template", async () => {
    const { service, sendWelcomeOffer } = build({ appEmail: true });
    await claim(service, "old@example.com");
    expect(sendWelcomeOffer.mock.calls[0][0].template).toEqual(defaultEmail);
  });

  it("a duplicate submission never sends a second email", async () => {
    const { service, sendWelcomeOffer } = build({ appEmail: true });
    await claim(service, "dup@example.com");
    expect((await claim(service, " DUP@example.com")).status).toBe("already_claimed");
    expect(sendWelcomeOffer).toHaveBeenCalledTimes(1);
  });

  it("15 simultaneous submissions send one email", async () => {
    const { service, sendWelcomeOffer, issueCode } = build({ appEmail: true, sendEmail: () => new Promise((r) => setTimeout(r, 40)) });
    const results = await Promise.all(Array.from({ length: 15 }, () => claim(service, "race@example.com")));
    expect(results.filter((r) => r.status === "claimed")).toHaveLength(1);
    expect(sendWelcomeOffer).toHaveBeenCalledTimes(1);
    expect(issueCode).toHaveBeenCalledTimes(1);
  });

  it("a failed send keeps the code, marks the claim failed, and the retry reuses the same code and claim id", async () => {
    let fail = true;
    const { service, sendWelcomeOffer, issueCode } = build({
      appEmail: true,
      sendEmail: () => {
        if (fail) throw new Error("Resend rejected the email (403)");
      },
    });
    await expect(claim(service, "fail@example.com")).rejects.toThrow("Resend rejected");
    const failed = await only();
    expect(failed).toMatchObject({ emailStatus: "FAILED", failureStep: "email", emailSentAt: null });

    fail = false;
    expect((await claim(service, "fail@example.com")).status).toBe("claimed");
    const ok = await only();
    expect(ok.discountCode).toBe(failed.discountCode);
    expect(ok).toMatchObject({ emailStatus: "EMAIL_SENT", failureStep: null });
    // The same claim id gives the same Resend idempotency key, so a send that did land is never duplicated.
    expect(sendWelcomeOffer.mock.calls.map(([i]) => i.claimId)).toEqual([failed.id, failed.id]);
    expect(issueCode.mock.calls.map(([a]) => a.code)).toEqual([failed.discountCode, failed.discountCode]);
    expect(await db.welcomeOfferClaim.count({ where: { shopDomain: shop } })).toBe(1);

    expect((await claim(service, "fail@example.com")).status).toBe("already_claimed");
    expect(sendWelcomeOffer).toHaveBeenCalledTimes(2);
  });

  it("a code that Shopify refuses stops before any email", async () => {
    const { service, sendWelcomeOffer } = build({
      appEmail: true,
      issueCode: () => {
        throw new Error("discounts down");
      },
    });
    await expect(claim(service, "nodiscount@example.com")).rejects.toThrow();
    expect(sendWelcomeOffer).not.toHaveBeenCalled();
    expect((await only()).failureStep).toBe("discount");
  });

  it("the claim still succeeds when only the metafield mirror fails after the email went out", async () => {
    const { service, sendWelcomeOffer } = build({
      appEmail: true,
      metafields: () => {
        throw new Error("metafieldsSet failed");
      },
    });
    expect((await claim(service, "mirror@example.com")).status).toBe("claimed");
    expect(sendWelcomeOffer).toHaveBeenCalledTimes(1);
    expect((await only()).emailStatus).toBe("EMAIL_SENT");
  });

  it("a claim created while Resend was missing is not emailed by the app later", async () => {
    // Flow handled this customer. Turning on app sending afterwards must not email them again.
    const flow = build();
    await claim(flow.service, "handled@example.com");
    expect((await only()).delivery).toBe("FLOW");

    const app = build({ appEmail: true });
    expect((await claim(app.service, "handled@example.com")).status).toBe("already_claimed");
    expect(app.sendWelcomeOffer).not.toHaveBeenCalled();
    expect(app.addClaimTag).not.toHaveBeenCalled();
  });

  it("a Flow claim that failed before the tag is finished through Flow, not by the app", async () => {
    let fail = true;
    const flow = build({ tag: () => { if (fail) throw new Error("tag down"); } });
    await expect(claim(flow.service, "stuck@example.com")).rejects.toThrow();
    fail = false;

    const app = build({ appEmail: true });
    expect((await claim(app.service, "stuck@example.com")).status).toBe("claimed");
    expect(app.addClaimTag).toHaveBeenCalledTimes(1);
    expect(app.sendWelcomeOffer).not.toHaveBeenCalled();
    expect(await only()).toMatchObject({ delivery: "FLOW", emailStatus: "READY_FOR_FLOW" });
  });

  it("an app claim retried after Resend was removed fails clearly instead of adding a Flow tag", async () => {
    let fail = true;
    const app = build({ appEmail: true, sendEmail: () => { if (fail) throw new Error("down"); } });
    await expect(claim(app.service, "gone@example.com")).rejects.toThrow();
    fail = false;

    const noEmail = build(); // Resend no longer configured
    await expect(claim(noEmail.service, "gone@example.com")).rejects.toThrow(/not configured/);
    expect(noEmail.addClaimTag).not.toHaveBeenCalled();
    expect(await only()).toMatchObject({ delivery: "APP", emailStatus: "FAILED", failureStep: "email" });
  });

  it("first-purchase eligibility still refuses a returning customer before anything is sent", async () => {
    await requireFirstPurchase();
    const { service, sendWelcomeOffer, order } = build({ appEmail: true, existing: { id: CUSTOMER_ID, hasOrders: true } });
    expect((await claim(service, "regular@example.com")).status).toBe("not_eligible");
    expect(sendWelcomeOffer).not.toHaveBeenCalled();
    expect(order).toEqual([]);
  });
});
