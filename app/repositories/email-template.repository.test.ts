import { afterAll, beforeEach, describe, expect, it } from "vitest";
import db from "../db.server";
import { emailTemplateRepository } from "./email-template.repository";
import { defaultEmail } from "../email/defaults";

const shop = `tpl-repo-${Date.now()}.myshopify.com`;
const other = `tpl-repo-other-${Date.now()}.myshopify.com`;

const clean = async () => {
  await db.campaign.deleteMany({ where: { shopDomain: { in: [shop, other] } } });
  await db.emailTemplate.deleteMany({ where: { shopDomain: { in: [shop, other] } } });
};
beforeEach(clean);
afterAll(async () => {
  await clean();
  await db.$disconnect();
});

describe("emailTemplateRepository", () => {
  it("creates, lists newest first and updates, scoped to the shop", async () => {
    const a = await emailTemplateRepository.create(shop, "A", defaultEmail);
    const b = await emailTemplateRepository.create(shop, "B", defaultEmail);
    await emailTemplateRepository.create(other, "Other", defaultEmail);
    await emailTemplateRepository.update(shop, a.id, "A2", { ...defaultEmail, subject: "New" });
    const list = await emailTemplateRepository.list(shop);
    expect(list.map((t) => t.name)).toEqual(["A2", "B"]);
    expect((list[0].template as { subject: string }).subject).toBe("New");
    expect(b.id).toBeTruthy();
  });

  it("never reads or changes another shop's template", async () => {
    const t = await emailTemplateRepository.create(other, "Theirs", defaultEmail);
    expect(await emailTemplateRepository.findById(shop, t.id)).toBeNull();
    expect(await emailTemplateRepository.exists(shop, t.id)).toBe(false);
    expect(await emailTemplateRepository.update(shop, t.id, "Hijack", defaultEmail)).toBe(false);
    expect(await emailTemplateRepository.remove(shop, t.id)).toEqual({ ok: false, reason: "NOT_FOUND" });
    expect((await db.emailTemplate.findUniqueOrThrow({ where: { id: t.id } })).name).toBe("Theirs");
  });

  it("refuses to delete a template a campaign uses, naming the campaign", async () => {
    const t = await emailTemplateRepository.create(shop, "Used", defaultEmail);
    await db.campaign.create({
      data: { shopDomain: shop, name: "Welcome 10%", discountCode: "W", content: {}, design: {}, rules: {}, emailTemplateId: t.id },
    });
    expect(await emailTemplateRepository.remove(shop, t.id)).toEqual({ ok: false, reason: "IN_USE", campaigns: ["Welcome 10%"] });
    expect((await emailTemplateRepository.list(shop))[0].campaigns.map((c) => c.name)).toEqual(["Welcome 10%"]);
  });

  it("deletes an unused template", async () => {
    const t = await emailTemplateRepository.create(shop, "Unused", defaultEmail);
    expect(await emailTemplateRepository.remove(shop, t.id)).toEqual({ ok: true });
    expect(await emailTemplateRepository.findById(shop, t.id)).toBeNull();
  });

  it("the database itself blocks deleting a template in use", async () => {
    const t = await emailTemplateRepository.create(shop, "Guarded", defaultEmail);
    await db.campaign.create({
      data: { shopDomain: shop, name: "C", discountCode: "W", content: {}, design: {}, rules: {}, emailTemplateId: t.id },
    });
    await expect(db.emailTemplate.delete({ where: { id: t.id } })).rejects.toThrow();
  });
});
