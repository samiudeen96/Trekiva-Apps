import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import db from "../db.server";
import { ClaimService } from "./claim.service";
import { InvalidEmailError, type CustomerGateway, type FlowGateway } from "./types";

const shop = `claim-test-${Date.now()}.myshopify.com`;
let campaignId: string;

const content = {
  successMessage: "Your 10% welcome offer is on its way! Check your inbox for your discount code.",
  alreadyClaimedMessage: "You’ve already claimed this welcome offer.",
};

function build(overrides: { flow?: FlowGateway["triggerWelcomeOfferClaimed"] } = {}) {
  const findOrCreate = vi.fn<CustomerGateway["findOrCreate"]>(async () => "gid://shopify/Customer/1");
  const trigger = vi.fn<FlowGateway["triggerWelcomeOfferClaimed"]>(
    overrides.flow ?? (async () => undefined),
  );
  const writeClaimMetafields = vi.fn<CustomerGateway["writeClaimMetafields"]>(async () => undefined);
  const service = new ClaimService(
    { findOrCreate, writeClaimMetafields },
    { triggerWelcomeOfferClaimed: trigger },
  );
  return { service, findOrCreate, trigger, writeClaimMetafields };
}

beforeEach(async () => {
  await db.welcomeOfferClaim.deleteMany({ where: { shopDomain: shop } });
  await db.campaign.deleteMany({ where: { shopDomain: shop } });
  const c = await db.campaign.create({
    data: {
      shopDomain: shop,
      name: "Welcome 10% Popup",
      status: "ACTIVE",
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
  it("first claim triggers Flow once and stores the claim", async () => {
    const { service, trigger, writeClaimMetafields } = build();
    const out = await service.claim({ shopDomain: shop, campaignId, email: "  Customer@Example.com " });
    expect(writeClaimMetafields).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ status: "claimed", message: content.successMessage });
    expect(trigger).toHaveBeenCalledTimes(1);
    const rows = await db.welcomeOfferClaim.findMany({ where: { shopDomain: shop } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      emailNormalized: "customer@example.com",
      discountCode: "WELCOME10",
      shopifyCustomerId: "gid://shopify/Customer/1",
      emailStatus: "TRIGGERED",
    });
  });

  it("same email (any casing) is already_claimed: no Flow, no new row", async () => {
    const { service, trigger, findOrCreate, writeClaimMetafields } = build();
    await service.claim({ shopDomain: shop, campaignId, email: "a@b.co" });
    const out = await service.claim({ shopDomain: shop, campaignId, email: " A@B.CO" });
    expect(out).toEqual({ status: "already_claimed", message: content.alreadyClaimedMessage });
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(findOrCreate).toHaveBeenCalledTimes(1);
    expect(writeClaimMetafields).toHaveBeenCalledTimes(1);
    expect(await db.welcomeOfferClaim.count({ where: { shopDomain: shop } })).toBe(1);
  });

  it("25 concurrent submissions produce exactly one claim and one Flow trigger", async () => {
    const { service, trigger } = build({
      flow: () => new Promise((r) => setTimeout(r, 50)),
    });
    const results = await Promise.all(
      Array.from({ length: 25 }, () =>
        service.claim({ shopDomain: shop, campaignId, email: "race@example.com" }),
      ),
    );
    expect(results.filter((r) => r.status === "claimed")).toHaveLength(1);
    expect(results.filter((r) => r.status === "already_claimed")).toHaveLength(24);
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(await db.welcomeOfferClaim.count({ where: { shopDomain: shop } })).toBe(1);
  });

  it("a different email can still claim", async () => {
    const { service, trigger } = build();
    await service.claim({ shopDomain: shop, campaignId, email: "one@example.com" });
    const out = await service.claim({ shopDomain: shop, campaignId, email: "two@example.com" });
    expect(out.status).toBe("claimed");
    expect(trigger).toHaveBeenCalledTimes(2);
  });

  it("failed fulfilment (Flow never triggered) can be retried exactly once", async () => {
    let fail = true;
    const { service, trigger } = build({
      flow: async () => {
        if (fail) throw new Error("flow down");
      },
    });
    await expect(service.claim({ shopDomain: shop, campaignId, email: "x@example.com" })).rejects.toThrow();
    expect((await db.welcomeOfferClaim.findFirstOrThrow({ where: { shopDomain: shop } })).emailStatus).toBe("FAILED");

    fail = false;
    const results = await Promise.all(
      Array.from({ length: 5 }, () => service.claim({ shopDomain: shop, campaignId, email: "x@example.com" })),
    );
    expect(results.filter((r) => r.status === "claimed")).toHaveLength(1);
    expect(trigger).toHaveBeenCalledTimes(2); // 1 failed + 1 successful retry
    expect(await db.welcomeOfferClaim.count({ where: { shopDomain: shop } })).toBe(1);

    const again = await service.claim({ shopDomain: shop, campaignId, email: "x@example.com" });
    expect(again.status).toBe("already_claimed");
    expect(trigger).toHaveBeenCalledTimes(2);
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
