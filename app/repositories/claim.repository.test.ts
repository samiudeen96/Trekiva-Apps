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

  it("filters by email status and marketing, combined with search and paging", async () => {
    // Seeded: user0 FAILED, everyone else PENDING; all share the default UNKNOWN eligibility.
    const failed = await claimRepository.list(shop, 1, "", { status: "failed" });
    expect(failed.rows.map((x) => x.emailNormalized)).toEqual(["user0@example.com"]);
    expect(failed.total).toBe(1);

    const pending = await claimRepository.list(shop, 1, "", { status: "pending" });
    expect(pending.total).toBe(TOTAL - 1);

    // A filter narrows the search too, and total reflects the filtered set (so paging is right).
    expect((await claimRepository.list(shop, 1, "user0@", { status: "pending" })).total).toBe(0);
    expect((await claimRepository.list(shop, 2, "", { status: "pending" })).rows).toHaveLength(4);

    expect((await claimRepository.list(shop, 1, "", { marketing: "UNKNOWN" })).total).toBe(TOTAL);
    expect((await claimRepository.list(shop, 1, "", { marketing: "SUBSCRIBED" })).total).toBe(0);
    expect((await claimRepository.list(shop, 1, "", { status: "sent" })).total).toBe(0);
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

describe("claimRepository: Flow email-sent sync", () => {
  const syncShop = `claims-sync-${Date.now()}.myshopify.com`;
  let campaignId: string;

  const seed = async (email: string, customer: string, data: Record<string, unknown> = {}) =>
    db.welcomeOfferClaim.create({
      data: {
        shopDomain: syncShop,
        campaignId,
        emailNormalized: email,
        discountCode: `S-${email}`,
        shopifyCustomerId: customer,
        emailStatus: "READY_FOR_FLOW",
        emailEligibility: "SUBSCRIBED",
        ...data,
      },
    });

  beforeAll(async () => {
    campaignId = (
      await db.campaign.create({
        data: { shopDomain: syncShop, name: "S", status: "ACTIVE", discountCode: "W", content: {}, design: {}, rules: {} },
      })
    ).id;
  });
  afterAll(async () => {
    await db.welcomeOfferClaim.deleteMany({ where: { shopDomain: syncShop } });
    await db.campaign.deleteMany({ where: { shopDomain: syncShop } });
  });

  it("only looks at customers with a claim waiting for Flow", async () => {
    await seed("wait@x.co", "gid://shopify/Customer/1");
    await seed("done@x.co", "gid://shopify/Customer/2", { emailStatus: "EMAIL_SENT" });
    expect(await claimRepository.hasPendingHandoff(syncShop, "gid://shopify/Customer/1")).toBe(true);
    expect(await claimRepository.hasPendingHandoff(syncShop, "gid://shopify/Customer/2")).toBe(false);
    expect(await claimRepository.hasPendingHandoff(syncShop, "gid://shopify/Customer/404")).toBe(false);
    expect(await claimRepository.hasPendingHandoff("other.myshopify.com", "gid://shopify/Customer/1")).toBe(false);
  });

  it("marks a waiting claim as sent once, scoped to the shop", async () => {
    const row = await db.welcomeOfferClaim.findFirstOrThrow({ where: { shopDomain: syncShop, emailNormalized: "wait@x.co" } });
    expect(await claimRepository.markEmailSent("other.myshopify.com", "gid://shopify/Customer/1")).toBe(0);
    expect(await claimRepository.markEmailSent(syncShop, "gid://shopify/Customer/1")).toBe(1);
    expect(await claimRepository.markEmailSent(syncShop, "gid://shopify/Customer/1")).toBe(0);
    const after = await db.welcomeOfferClaim.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.emailStatus).toBe("EMAIL_SENT");
    expect(after.emailSentAt).not.toBeNull();
  });

  it("does not report Email sent for a customer Shopify Email cannot deliver to", async () => {
    await seed("unsub@x.co", "gid://shopify/Customer/3", { emailEligibility: "NOT_SUBSCRIBED" });
    expect(await claimRepository.markEmailSent(syncShop, "gid://shopify/Customer/3")).toBe(0);
    expect((await db.welcomeOfferClaim.findFirstOrThrow({ where: { shopDomain: syncShop, emailNormalized: "unsub@x.co" } })).emailStatus).toBe("READY_FOR_FLOW");
  });

  it("counts not-subscribed claims by eligibility and by the legacy status", async () => {
    await seed("legacy@x.co", "gid://shopify/Customer/4", { emailStatus: "NOT_SUBSCRIBED", emailEligibility: "UNKNOWN" });
    const stats = await claimRepository.stats(syncShop);
    expect(stats.notSubscribed).toBe(2); // unsub@x.co (eligibility) + legacy@x.co (legacy status)
    expect(stats.lastHandoffAt).toBeNull();
  });
});

describe("claimRepository: dashboard numbers", () => {
  const dashShop = `claims-dash-${Date.now()}.myshopify.com`;
  const day = (offset: number, hour = 12) => {
    const d = new Date();
    d.setUTCHours(hour, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - offset);
    return d;
  };
  let campaignId: string;

  beforeAll(async () => {
    campaignId = (
      await db.campaign.create({
        data: { shopDomain: dashShop, name: "D", status: "ACTIVE", discountCode: "W", content: {}, design: {}, rules: {} },
      })
    ).id;
    const mk = (i: number, claimedAt: Date, data: Record<string, unknown> = {}) =>
      db.welcomeOfferClaim.create({
        data: { shopDomain: dashShop, campaignId, emailNormalized: `d${i}@x.co`, discountCode: `D-${i}`, claimedAt, ...data },
      });
    await mk(1, day(0));
    await mk(2, day(0, 1));
    await mk(3, day(2));
    await mk(4, day(20)); // outside the 14-day chart
    await mk(5, day(9)); // in the previous 7 days
    await mk(6, day(1), { emailStatus: "EMAIL_SENT", emailEligibility: "NOT_SUBSCRIBED", delivery: "APP" });
    await mk(7, day(1), { emailStatus: "READY_FOR_FLOW", emailEligibility: "NOT_SUBSCRIBED" });
    await db.welcomeOfferClaim.create({
      data: { shopDomain: `other-${dashShop}`, campaignId, emailNormalized: "z@x.co", discountCode: "Z", claimedAt: day(0) },
    }).catch(() => undefined);
  });
  afterAll(async () => {
    await db.welcomeOfferClaim.deleteMany({ where: { shopDomain: { in: [dashShop, `other-${dashShop}`] } } });
    await db.campaign.deleteMany({ where: { shopDomain: dashShop } });
  });

  it("groups claims by UTC day inside the window only, for this shop only", async () => {
    const rows = await claimRepository.dailyCounts(dashShop, 14);
    const total = rows.reduce((a, r) => a + r.n, 0);
    expect(total).toBe(6); // seven claims minus the one 20 days ago
    const today = day(0).toISOString().slice(0, 10);
    expect(rows.find((r) => r.day === today)?.n).toBe(2);
    expect(rows.every((r) => typeof r.n === "number")).toBe(true);
  });

  it("counts the previous 7 days separately from the last 7", async () => {
    const stats = await claimRepository.stats(dashShop);
    expect(stats.last7Days).toBe(5);
    expect(stats.previous7Days).toBe(1);
  });

  it("does not call a customer the app already emailed 'not subscribed': only claims Flow cannot deliver", async () => {
    const stats = await claimRepository.stats(dashShop);
    expect(stats.notSubscribed).toBe(1);
  });

  it("returns delivery counts in one grouped query", async () => {
    const rows = await claimRepository.deliveryCounts(dashShop);
    expect(rows.reduce((a, r) => a + r.n, 0)).toBe(7);
    expect(rows.find((r) => r.status === "EMAIL_SENT" && r.eligibility === "NOT_SUBSCRIBED")?.n).toBe(1);
  });
});
