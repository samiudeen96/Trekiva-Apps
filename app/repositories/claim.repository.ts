import type { Prisma } from "@prisma/client";
import db from "../db.server";

export const CLAIMS_PAGE_SIZE = 25;

const include = { campaign: { select: { name: true } } } as const;

function where(shopDomain: string, q?: string): Prisma.WelcomeOfferClaimWhereInput {
  const term = q?.trim().toLowerCase();
  return {
    shopDomain,
    ...(term ? { emailNormalized: { contains: term } } : {}),
  };
}

export const claimRepository = {
  async list(shopDomain: string, page: number, q?: string) {
    const filter = where(shopDomain, q);
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

  async stats(shopDomain: string) {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const weekAgo = new Date(Date.now() - 7 * 86400000);
    const [total, today, last7Days, failed, notSubscribed, lastSend] = await Promise.all([
      db.welcomeOfferClaim.count({ where: { shopDomain } }),
      db.welcomeOfferClaim.count({ where: { shopDomain, claimedAt: { gte: startOfToday } } }),
      db.welcomeOfferClaim.count({ where: { shopDomain, claimedAt: { gte: weekAgo } } }),
      db.welcomeOfferClaim.count({ where: { shopDomain, emailStatus: "FAILED" } }),
      db.welcomeOfferClaim.count({ where: { shopDomain, emailStatus: "NOT_SUBSCRIBED" } }),
      db.welcomeOfferClaim.aggregate({ where: { shopDomain }, _max: { emailSentAt: true } }),
    ]);
    return { total, today, last7Days, failed, notSubscribed, lastEmailSentAt: lastSend._max.emailSentAt };
  },
};
