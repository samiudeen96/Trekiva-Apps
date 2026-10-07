import type { Prisma } from "@prisma/client";
import db from "../db.server";
import type { CampaignInput } from "../campaigns/schema";

export interface DiscountRef {
  id: string;
  code: string;
  title: string;
}

const toData = (input: CampaignInput, discount: DiscountRef | null) => ({
  discountId: discount?.id ?? null,
  discountCode: discount?.code ?? null,
  discountTitle: discount?.title ?? null,
  name: input.details.name,
  status: input.details.status,
  template: input.details.template,
  content: input.content as Prisma.InputJsonValue,
  design: input.design as Prisma.InputJsonValue,
  rules: input.rules as Prisma.InputJsonValue,
  emailTemplateId: input.emailTemplateId,
});

export type RemoveCampaignResult =
  | { ok: true; claimsDeleted: number }
  | { ok: false; reason: "NOT_FOUND" | "ACTIVE" };

export const campaignRepository = {
  listWithClaimCounts(shopDomain: string) {
    return db.campaign.findMany({
      where: { shopDomain },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { claims: true } } },
    });
  },

  // Always scoped by shop so one merchant can never read another's campaign.
  findById(shopDomain: string, id: string) {
    return db.campaign.findFirst({ where: { id, shopDomain } });
  },

  /**
   * Deletes a campaign with its claims (they reference it with onDelete: Restrict). An ACTIVE
   * campaign is refused here, not just in the UI: the status is re-read inside the transaction, so
   * a campaign activated a moment ago cannot be deleted by a stale page.
   */
  remove(shopDomain: string, id: string): Promise<RemoveCampaignResult> {
    return db.$transaction(async (tx) => {
      const campaign = await tx.campaign.findFirst({ where: { id, shopDomain }, select: { status: true } });
      if (!campaign) return { ok: false, reason: "NOT_FOUND" } as const;
      if (campaign.status === "ACTIVE") return { ok: false, reason: "ACTIVE" } as const;
      const { count } = await tx.welcomeOfferClaim.deleteMany({ where: { campaignId: id, shopDomain } });
      await tx.campaign.deleteMany({ where: { id, shopDomain } });
      return { ok: true, claimsDeleted: count } as const;
    });
  },

  create(shopDomain: string, input: CampaignInput, discount: DiscountRef | null) {
    return db.campaign.create({ data: { shopDomain, ...toData(input, discount) } });
  },

  async update(shopDomain: string, id: string, input: CampaignInput, discount: DiscountRef | null) {
    const { count } = await db.campaign.updateMany({
      where: { id, shopDomain },
      data: toData(input, discount),
    });
    return count > 0;
  },
};
