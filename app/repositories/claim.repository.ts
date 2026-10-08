import { Prisma } from "@prisma/client";
import db from "../db.server";
import { windowStart } from "../dashboard/metrics";

export const CLAIMS_PAGE_SIZE = 25;

const include = { campaign: { select: { name: true } } } as const;

/** The email-status filter groups the statuses the way the badges read, legacy ones included. */
export const STATUS_FILTERS = {
  sent: ["EMAIL_SENT", "SENT"],
  pending: ["PENDING"],
  failed: ["FAILED"],
  flow: ["READY_FOR_FLOW", "TRIGGERED", "NOT_SUBSCRIBED"],
} as const;
export type StatusFilter = keyof typeof STATUS_FILTERS;
export const MARKETING_FILTERS = ["SUBSCRIBED", "NOT_SUBSCRIBED", "UNKNOWN"] as const;
export type MarketingFilter = (typeof MARKETING_FILTERS)[number];

export interface ClaimFilters {
  status?: StatusFilter;
  marketing?: MarketingFilter;
}

function where(shopDomain: string, q?: string, f: ClaimFilters = {}): Prisma.WelcomeOfferClaimWhereInput {
  const term = q?.trim().toLowerCase();
  return {
    shopDomain,
    ...(term ? { emailNormalized: { contains: term } } : {}),
    ...(f.status ? { emailStatus: { in: [...STATUS_FILTERS[f.status]] } } : {}),
    ...(f.marketing ? { emailEligibility: f.marketing } : {}),
  };
}

export const claimRepository = {
  async list(shopDomain: string, page: number, q?: string, filters?: ClaimFilters) {
    const filter = where(shopDomain, q, filters);
    const [rows, total] = await Promise.all([
      db.welcomeOfferClaim.findMany({
        where: filter,
        orderBy: { claimedAt: "desc" },
        skip: (Math.max(page, 1) - 1) * CLAIMS_PAGE_SIZE,
        take: CLAIMS_PAGE_SIZE,
        include,
      }),
      db.welcomeOfferClaim.count({ where: filter }),
    ]);
    return { rows, total };
  },

  recent(shopDomain: string, take: number) {
    return db.welcomeOfferClaim.findMany({
      where: { shopDomain },
      orderBy: { claimedAt: "desc" },
      take,
      include,
    });
  },

  /** Streams through the table in batches so large exports do not load everything at once. */
  async *exportBatches(shopDomain: string, batchSize = 500) {
    let cursor: string | undefined;
    for (;;) {
      const rows = await db.welcomeOfferClaim.findMany({
        where: { shopDomain },
        orderBy: { id: "asc" },
        take: batchSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include,
      });
      if (rows.length === 0) return;
      yield rows;
      cursor = rows[rows.length - 1].id;
    }
  },

  /** Scoped by shop so one merchant can never delete another's claim. False when it does not exist. */
  async delete(shopDomain: string, id: string) {
    const { count } = await db.welcomeOfferClaim.deleteMany({ where: { id, shopDomain } });
    return count > 0;
  },

  /** Claims whose last attempt failed, newest first, with the reason it was recorded. */
  failed(shopDomain: string, take: number) {
    return db.welcomeOfferClaim.findMany({
      where: { shopDomain, emailStatus: "FAILED" },
      orderBy: { updatedAt: "desc" },
      take,
      include,
    });
  },

  /** True when this customer has a claim waiting for Flow, so the webhook can skip everyone else. */
  async hasPendingHandoff(shopDomain: string, shopifyCustomerId: string) {
    const row = await db.welcomeOfferClaim.findFirst({
      where: { shopDomain, shopifyCustomerId, emailStatus: "READY_FOR_FLOW" },
      select: { id: true },
    });
    return row !== null;
  },

  /**
   * Flow added the email-sent tag. Claims for customers Shopify Email will not deliver to stay
   * READY_FOR_FLOW (shown as Not subscribed), because Flow tags them even when the email is skipped.
   */
  async markEmailSent(shopDomain: string, shopifyCustomerId: string) {
    const { count } = await db.welcomeOfferClaim.updateMany({
      where: {
        shopDomain,
        shopifyCustomerId,
        emailStatus: "READY_FOR_FLOW",
        emailEligibility: { not: "NOT_SUBSCRIBED" },
      },
      data: { emailStatus: "EMAIL_SENT", emailSentAt: new Date() },
    });
    return count;
  },

  /** Claims per UTC day over the last `days` days (days with none are absent: the caller fills them in). */
  dailyCounts(shopDomain: string, days: number) {
    const since = windowStart(days);
    return db.$queryRaw<{ day: string; n: number }[]>(Prisma.sql`
      SELECT to_char("claimed_at", 'YYYY-MM-DD') AS day, COUNT(*)::int AS n
      FROM "welcome_offer_claims"
      WHERE "shop_domain" = ${shopDomain} AND "claimed_at" >= ${since}
      GROUP BY 1`);
  },

  /** Claims by email status and consent, for the dashboard's delivery breakdown. One grouped query, no per-row calls. */
  async deliveryCounts(shopDomain: string) {
    const rows = await db.welcomeOfferClaim.groupBy({
      by: ["emailStatus", "emailEligibility"],
      where: { shopDomain },
      _count: { _all: true },
    });
    return rows.map((r) => ({ status: r.emailStatus, eligibility: r.emailEligibility, n: r._count._all }));
  },

  async stats(shopDomain: string) {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const weekAgo = new Date(Date.now() - 7 * 86400000);
    const twoWeeksAgo = new Date(Date.now() - 14 * 86400000);
    const [total, today, last7Days, previous7Days, failed, notSubscribed, lastTrigger] = await Promise.all([
      db.welcomeOfferClaim.count({ where: { shopDomain } }),
      db.welcomeOfferClaim.count({ where: { shopDomain, claimedAt: { gte: startOfToday } } }),
      db.welcomeOfferClaim.count({ where: { shopDomain, claimedAt: { gte: weekAgo } } }),
      db.welcomeOfferClaim.count({ where: { shopDomain, claimedAt: { gte: twoWeeksAgo, lt: weekAgo } } }),
      db.welcomeOfferClaim.count({ where: { shopDomain, emailStatus: "FAILED" } }),
      db.welcomeOfferClaim.count({
        // Only claims Flow must deliver: one the app already emailed (code-only) did reach the customer.
        where: {
          shopDomain,
          OR: [{ emailEligibility: "NOT_SUBSCRIBED", delivery: "FLOW" }, { emailStatus: "NOT_SUBSCRIBED" }],
        },
      }),
      db.welcomeOfferClaim.aggregate({ where: { shopDomain }, _max: { flowHandoffAt: true } }),
    ]);
    return { total, today, last7Days, previous7Days, failed, notSubscribed, lastHandoffAt: lastTrigger._max.flowHandoffAt };
  },
};
