import { afterAll, beforeEach, describe, expect, it } from "vitest";
import db from "../db.server";
import { campaignRepository } from "./campaign.repository";
import { claimRepository } from "./claim.repository";

const shop = `delete-test-${Date.now()}.myshopify.com`;
const other = `delete-test-other-${Date.now()}.myshopify.com`;

const mkCampaign = (shopDomain: string, status: "ACTIVE" | "DRAFT" | "DISABLED" = "DRAFT") =>
  db.campaign.create({
    data: { shopDomain, name: "C", status, discountCode: "W", content: {}, design: {}, rules: {} },
  });
const mkClaim = (shopDomain: string, campaignId: string, email: string) =>
  db.welcomeOfferClaim.create({
    data: { shopDomain, campaignId, emailNormalized: email, discountCode: `W-${email}` },
  });

async function clean() {
  for (const s of [shop, other]) {
    await db.welcomeOfferClaim.deleteMany({ where: { shopDomain: s } });
    await db.campaign.deleteMany({ where: { shopDomain: s } });
  }
}
beforeEach(clean);
afterAll(async () => {
  await clean();
  await db.$disconnect();
});

describe("claimRepository.delete", () => {
  it("deletes the claim so the same email can claim again", async () => {
    const c = await mkCampaign(shop);
    const claim = await mkClaim(shop, c.id, "a@x.co");
    expect(await claimRepository.delete(shop, claim.id)).toBe(true);
    expect(await db.welcomeOfferClaim.count({ where: { shopDomain: shop } })).toBe(0);
    await expect(mkClaim(shop, c.id, "a@x.co")).resolves.toBeTruthy();
  });

  it("never deletes another shop's claim", async () => {
    const o = await mkCampaign(other);
    const claim = await mkClaim(other, o.id, "a@x.co");
    expect(await claimRepository.delete(shop, claim.id)).toBe(false);
    expect(await db.welcomeOfferClaim.count({ where: { shopDomain: other } })).toBe(1);
  });

  it("returns false for a claim that does not exist", async () => {
    expect(await claimRepository.delete(shop, "nope")).toBe(false);
  });
});

describe("campaignRepository.remove", () => {
  it("refuses an ACTIVE campaign and keeps it and its claims", async () => {
    const c = await mkCampaign(shop, "ACTIVE");
    await mkClaim(shop, c.id, "a@x.co");
    expect(await campaignRepository.remove(shop, c.id)).toEqual({ ok: false, reason: "ACTIVE" });
    expect(await db.campaign.count({ where: { id: c.id } })).toBe(1);
    expect(await db.welcomeOfferClaim.count({ where: { campaignId: c.id } })).toBe(1);
  });

  it("deletes a DRAFT campaign together with its claims", async () => {
    const c = await mkCampaign(shop, "DRAFT");
    await mkClaim(shop, c.id, "a@x.co");
    await mkClaim(shop, c.id, "b@x.co");
    expect(await campaignRepository.remove(shop, c.id)).toEqual({ ok: true, claimsDeleted: 2 });
    expect(await db.campaign.count({ where: { id: c.id } })).toBe(0);
    expect(await db.welcomeOfferClaim.count({ where: { campaignId: c.id } })).toBe(0);
  });

  it("deletes a DISABLED campaign with no claims", async () => {
    const c = await mkCampaign(shop, "DISABLED");
    expect(await campaignRepository.remove(shop, c.id)).toEqual({ ok: true, claimsDeleted: 0 });
  });

  it("works once an ACTIVE campaign has been set to DRAFT", async () => {
    const c = await mkCampaign(shop, "ACTIVE");
    expect((await campaignRepository.remove(shop, c.id)).ok).toBe(false);
    await db.campaign.update({ where: { id: c.id }, data: { status: "DRAFT" } });
    expect((await campaignRepository.remove(shop, c.id)).ok).toBe(true);
  });

  it("never touches another shop's campaign or its claims", async () => {
    const o = await mkCampaign(other, "DRAFT");
    await mkClaim(other, o.id, "a@x.co");
    expect(await campaignRepository.remove(shop, o.id)).toEqual({ ok: false, reason: "NOT_FOUND" });
    expect(await db.campaign.count({ where: { id: o.id } })).toBe(1);
    expect(await db.welcomeOfferClaim.count({ where: { campaignId: o.id } })).toBe(1);
  });
});
