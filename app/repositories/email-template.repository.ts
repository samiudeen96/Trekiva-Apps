import type { Prisma } from "@prisma/client";
import db from "../db.server";
import type { EmailTemplate } from "../email/schema";

export type RemoveTemplateResult =
  | { ok: true }
  | { ok: false; reason: "NOT_FOUND" }
  | { ok: false; reason: "IN_USE"; campaigns: string[] };

// Every query is scoped by shop, so one merchant can never read or change another's template.
export const emailTemplateRepository = {
  list(shopDomain: string) {
    return db.emailTemplate.findMany({
      where: { shopDomain },
      orderBy: { updatedAt: "desc" },
      include: { campaigns: { select: { id: true, name: true, status: true } } },
    });
  },

  findById(shopDomain: string, id: string) {
    return db.emailTemplate.findFirst({ where: { id, shopDomain } });
  },

  async exists(shopDomain: string, id: string) {
    return (await db.emailTemplate.count({ where: { id, shopDomain } })) === 1;
  },

  create(shopDomain: string, name: string, template: EmailTemplate) {
    return db.emailTemplate.create({
      data: { shopDomain, name, template: template as unknown as Prisma.InputJsonValue },
    });
  },

  async update(shopDomain: string, id: string, name: string, template: EmailTemplate) {
    const { count } = await db.emailTemplate.updateMany({
      where: { id, shopDomain },
      data: { name, template: template as unknown as Prisma.InputJsonValue },
    });
    return count > 0;
  },

  /**
   * A template a campaign still uses cannot be deleted: that campaign would silently fall back to the
   * default email. Checked inside the transaction (and enforced by the foreign key) so a campaign that
   * picked it a moment ago is not missed.
   */
  remove(shopDomain: string, id: string): Promise<RemoveTemplateResult> {
    return db.$transaction(async (tx) => {
      const found = await tx.emailTemplate.findFirst({
        where: { id, shopDomain },
        include: { campaigns: { select: { name: true } } },
      });
      if (!found) return { ok: false, reason: "NOT_FOUND" } as const;
      if (found.campaigns.length) {
        return { ok: false, reason: "IN_USE", campaigns: found.campaigns.map((c) => c.name) } as const;
      }
      await tx.emailTemplate.deleteMany({ where: { id, shopDomain } });
      return { ok: true } as const;
    });
  },
};
