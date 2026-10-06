import { afterAll, beforeAll, describe, expect, it } from "vitest";
import db from "../db.server";
import { CLAIMS_PAGE_SIZE, claimRepository } from "./claim.repository";

const shop = `claims-repo-${Date.now()}.myshopify.com`;
const other = `claims-repo-other-${Date.now()}.myshopify.com`;
const TOTAL = CLAIMS_PAGE_SIZE + 5;

beforeAll(async () => {
  const mk = (shopDomain: string) =>
    db.campaign.create({
      data: { shopDomain, name: "C", status: "ACTIVE", discountCode: "W", content: {}, design: {}, rules: {} },
    });
  const [c, o] = await Promise.all([mk(shop), mk(other)]);
  await db.welcomeOfferClaim.createMany({
    data: Array.from({ length: TOTAL }, (_, i) => ({
      shopDomain: shop,
      campaignId: c.id,
      emailNormalized: `user${i}@example.com`,
      // Unique per shop: claims share a discount, never a code.
      discountCode: `W-${i}`,
      claimedAt: new Date(Date.now() - i * 1000),
      ...(i === 0 ? { emailStatus: "FAILED" as const } : {}),
    })),
  });
  await db.welcomeOfferClaim.create({
    data: { shopDomain: other, campaignId: o.id, emailNormalized: "x@other.com", discountCode: "W" },
  });
});

afterAll(async () => {
  await db.welcomeOfferClaim.deleteMany({ where: { shopDomain: { in: [shop, other] } } });
  await db.campaign.deleteMany({ where: { shopDomain: { in: [shop, other] } } });
  await db.$disconnect();
});

describe("claimRepository", () => {
  it("pages newest first and never leaks other shops", async () => {
    const p1 = await claimRepository.list(shop, 1);
    const p2 = await claimRepository.list(shop, 2);
    expect(p1.total).toBe(TOTAL);
    expect(p1.rows).toHaveLength(CLAIMS_PAGE_SIZE);
    expect(p2.rows).toHaveLength(5);
    expect(p1.rows[0].emailNormalized).toBe("user0@example.com");
    expect([...p1.rows, ...p2.rows].some((r) => r.shopDomain !== shop)).toBe(false);
  });

  it("searches by email case-insensitively", async () => {
    const r = await claimRepository.list(shop, 1, "  USER7@");
    expect(r.rows.map((x) => x.emailNormalized)).toEqual(["user7@example.com"]);
  });

  it("exports every row exactly once across batches", async () => {
    const seen: string[] = [];
    for await (const batch of claimRepository.exportBatches(shop, 10)) seen.push(...batch.map((b) => b.id));
    expect(seen).toHaveLength(TOTAL);
    expect(new Set(seen).size).toBe(TOTAL);
  });

  it("computes stats", async () => {
    const s = await claimRepository.stats(shop);
    expect(s.total).toBe(TOTAL);
    expect(s.failed).toBe(1);
    expect(s.last7Days).toBe(TOTAL);
  });
});
