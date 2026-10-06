import type { Campaign } from "@prisma/client";
import { campaignToInput } from "./service";
import type { CampaignContent, CampaignDesign, CampaignRules } from "./schema";

export interface PublicCampaign {
  id: string;
  template: Campaign["template"];
  content: CampaignContent;
  design: CampaignDesign;
  rules: CampaignRules;
}

/**
 * Whitelist serializer for the storefront. It must never include the discount
 * code/id, the shop domain or anything else internal.
 */
export function toPublicCampaign(c: Campaign): PublicCampaign {
  const { content, design, rules, details } = campaignToInput(c);
  return { id: c.id, template: details.template, content, design, rules };
}
