import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import db from "../db.server";
import { ClaimService } from "./claim.service";
import {
  InvalidEmailError,
  type CustomerGateway,
  type DiscountCodeGateway,
  type EmailGateway,
} from "./types";

const shop = `claim-test-${Date.now()}.myshopify.com`;
const DISCOUNT_ID = "gid://shopify/DiscountCodeNode/1";
const CLAIM_CODE = /^WELCOME10-[A-Z2-9]{8}$/;
let campaignId: string;

const content = {
  successMessage: "Your 10% welcome offer is on its way! Check your inbox for your discount code.",
  alreadyClaimedMessage: "You’ve already claimed this welcome offer.",
};

function build(
  overrides: {
    email?: EmailGateway["sendWelcomeOffer"];
    issueCode?: DiscountCodeGateway["issueCode"];
    subscribed?: boolean;
  } = {},
) {
  const findOrCreate = vi.fn<CustomerGateway["findOrCreate"]>(async () => ({
    id: "gid://shopify/Customer/1",
    subscribed: overrides.subscribed ?? true,
  }));
  const issueCode = vi.fn<DiscountCodeGateway["issueCode"]>(overrides.issueCode ?? (async () => undefined));
  const send = vi.fn<EmailGateway["sendWelcomeOffer"]>(
    overrides.email ?? (async () => undefined),
  );
  const writeClaimMetafields = vi.fn<CustomerGateway["writeClaimMetafields"]>(async () => undefined);
  const service = new ClaimService(
    { findOrCreate, writeClaimMetafields },
    { sendWelcomeOffer: send },
    { issueCode },
  );
  return { service, findOrCreate, send, writeClaimMetafields, issueCode };
}

beforeEach(async () => {
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

describe("ClaimService", () => {
  it("first claim issues its own code, emails it once and stores the claim", async () => {
    const { service, send, writeClaimMetafields, issueCode } = build();
    const out = await service.claim({ shopDomain: shop, campaignId, email: "  Customer@Example.com " });
    expect(writeClaimMetafields).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ status: "claimed", message: content.successMessage });
    expect(send).toHaveBeenCalledTimes(1);
    const rows = await db.welcomeOfferClaim.findMany({ where: { shopDomain: shop } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      emailNormalized: "customer@example.com",
      discountCode: expect.stringMatching(CLAIM_CODE),
      shopifyCustomerId: "gid://shopify/Customer/1",
      emailStatus: "SENT",
    });
    expect(rows[0].emailSentAt).not.toBeNull();
    const code = rows[0].discountCode;
    expect(issueCode).toHaveBeenCalledWith({ discountId: DISCOUNT_ID, code });
    expect(send.mock.calls[0][0].discountCode).toBe(code);
    expect(send.mock.calls[0][0].claimId).toBe(rows[0].id);
    expect(send.mock.calls[0][0].emailContent).toEqual({
      subject: "Your welcome offer code",
      heading: "Welcome to {{brand}}",
      body: expect.stringContaining("discount code"),
    });
    expect(writeClaimMetafields.mock.calls[0][0].discountCode).toBe(code);
  });

  it("sends the campaign's own email copy, and defaults for campaigns saved before it existed", async () => {
    const { service, send } = build();
    await db.campaign.update({
      where: { id: campaignId },
      data: { content: { ...content, emailSubject: "Sale!", emailHeading: "Hi", emailBody: "" } },
    });
    await service.claim({ shopDomain: shop, campaignId, email: "custom@example.com" });
    expect(send.mock.calls[0][0].emailContent).toEqual({ subject: "Sale!", heading: "Hi", body: "" });
  });

  it("every claim gets a different code", async () => {
    const { service } = build();
    await service.claim({ shopDomain: shop, campaignId, email: "one@example.com" });
    await service.claim({ shopDomain: shop, campaignId, email: "two@example.com" });
    const codes = (await db.welcomeOfferClaim.findMany({ where: { shopDomain: shop } })).map((r) => r.discountCode);
    expect(new Set(codes).size).toBe(2);
  });

  it("an opted-out customer is never emailed and is marked NOT_SUBSCRIBED", async () => {
    const { service, send } = build({ subscribed: false });
    const out = await service.claim({ shopDomain: shop, campaignId, email: "optout@example.com" });
    expect(out.status).toBe("claimed");
    expect(send).not.toHaveBeenCalled();
    const row = await db.welcomeOfferClaim.findFirstOrThrow({ where: { shopDomain: shop } });
    expect(row.emailStatus).toBe("NOT_SUBSCRIBED");
    expect(row.emailSentAt).toBeNull();

    // The claim is settled, so a resubmission is not retried into a send.
    const again = await service.claim({ shopDomain: shop, campaignId, email: "optout@example.com" });
    expect(again.status).toBe("already_claimed");
    expect(send).not.toHaveBeenCalled();
  });

  it("a failed code issue skips the email and the retry reuses the same code", async () => {
    let fail = true;
    const { service, send, issueCode } = build({
      issueCode: async () => {
        if (fail) throw new Error("discounts down");
      },
    });
    await expect(service.claim({ shopDomain: shop, campaignId, email: "y@example.com" })).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
    const row = await db.welcomeOfferClaim.findFirstOrThrow({ where: { shopDomain: shop } });
    expect(row.emailStatus).toBe("FAILED");

    fail = false;
    const out = await service.claim({ shopDomain: shop, campaignId, email: "y@example.com" });
    expect(out.status).toBe("claimed");
    expect(issueCode).toHaveBeenLastCalledWith({ discountId: DISCOUNT_ID, code: row.discountCode });
    expect(send.mock.calls[0][0].discountCode).toBe(row.discountCode);
  });

  it("same email (any casing) is already_claimed: no email, no new row", async () => {
    const { service, send, findOrCreate, writeClaimMetafields } = build();
    await service.claim({ shopDomain: shop, campaignId, email: "a@b.co" });
    const out = await service.claim({ shopDomain: shop, campaignId, email: " A@B.CO" });
    expect(out).toEqual({ status: "already_claimed", message: content.alreadyClaimedMessage });
    expect(send).toHaveBeenCalledTimes(1);
    expect(findOrCreate).toHaveBeenCalledTimes(1);
    expect(writeClaimMetafields).toHaveBeenCalledTimes(1);
    expect(await db.welcomeOfferClaim.count({ where: { shopDomain: shop } })).toBe(1);
  });

  it("25 concurrent submissions produce exactly one claim and one email", async () => {
    const { service, send } = build({
      email: () => new Promise((r) => setTimeout(r, 50)),
    });
    const results = await Promise.all(
      Array.from({ length: 25 }, () =>
        service.claim({ shopDomain: shop, campaignId, email: "race@example.com" }),
      ),
    );
    expect(results.filter((r) => r.status === "claimed")).toHaveLength(1);
    expect(results.filter((r) => r.status === "already_claimed")).toHaveLength(24);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await db.welcomeOfferClaim.count({ where: { shopDomain: shop } })).toBe(1);
  });

  it("a different email can still claim", async () => {
    const { service, send } = build();
    await service.claim({ shopDomain: shop, campaignId, email: "one@example.com" });
    const out = await service.claim({ shopDomain: shop, campaignId, email: "two@example.com" });
    expect(out.status).toBe("claimed");
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("failed fulfilment (email never sent) can be retried exactly once", async () => {
    let fail = true;
    const { service, send } = build({
      email: async () => {
        if (fail) throw new Error("resend down");
      },
    });
    await expect(service.claim({ shopDomain: shop, campaignId, email: "x@example.com" })).rejects.toThrow();
    expect((await db.welcomeOfferClaim.findFirstOrThrow({ where: { shopDomain: shop } })).emailStatus).toBe("FAILED");

    fail = false;
    const results = await Promise.all(
      Array.from({ length: 5 }, () => service.claim({ shopDomain: shop, campaignId, email: "x@example.com" })),
    );
    expect(results.filter((r) => r.status === "claimed")).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(2); // 1 failed + 1 successful retry
    expect(await db.welcomeOfferClaim.count({ where: { shopDomain: shop } })).toBe(1);

    const again = await service.claim({ shopDomain: shop, campaignId, email: "x@example.com" });
    expect(again.status).toBe("already_claimed");
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid emails and inactive campaigns", async () => {
    const { service } = build();
    await expect(service.claim({ shopDomain: shop, campaignId, email: "nope" })).rejects.toBeInstanceOf(InvalidEmailError);
    await db.campaign.update({ where: { id: campaignId }, data: { status: "DISABLED" } });
    await expect(service.claim({ shopDomain: shop, campaignId, email: "ok@example.com" })).rejects.toThrow();
  });

  it("does not claim across shops", async () => {
    const { service } = build();
    await expect(
      service.claim({ shopDomain: "other.myshopify.com", campaignId, email: "ok@example.com" }),
    ).rejects.toThrow();
  });
});
