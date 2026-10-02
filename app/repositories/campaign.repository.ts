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
});

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
