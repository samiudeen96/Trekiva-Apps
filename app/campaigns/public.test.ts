import type { Campaign } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { defaultCampaign as d } from "./defaults";
import { toPublicCampaign } from "./public";

describe("toPublicCampaign", () => {
  it("never leaks the discount or shop details", () => {
    const campaign = {
      id: "c1",
      shopDomain: "secret-shop.myshopify.com",
      name: "n",
      type: "WELCOME_DISCOUNT",
      status: "ACTIVE",
      template: "SPLIT_IMAGE",
      discountId: "gid://shopify/DiscountCodeNode/1",
      discountCode: "WELCOME10",
      discountTitle: "Welcome",
      content: d.content,
      design: d.design,
      rules: d.rules,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Campaign;
    const json = JSON.stringify(toPublicCampaign(campaign));
    expect(json).not.toContain("WELCOME10");
    expect(json).not.toContain("DiscountCodeNode");
    expect(json).not.toContain("secret-shop");
    expect(toPublicCampaign(campaign).id).toBe("c1");
  });
});
