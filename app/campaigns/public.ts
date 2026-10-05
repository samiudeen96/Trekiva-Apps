import type { Campaign } from "@prisma/client";
import { campaignToInput } from "./service";
import type { CampaignContent, CampaignDesign, CampaignRules } from "./schema";

const EMAIL_KEYS = ["emailSubject", "emailHeading", "emailBody"] as const;
type EmailKey = (typeof EMAIL_KEYS)[number];

export interface PublicCampaign {
  id: string;
  template: Campaign["template"];
  content: Omit<CampaignContent, EmailKey>;
  design: CampaignDesign;
  rules: CampaignRules;
}

/**
 * Whitelist serializer for the storefront. It must never include the discount
 * code/id, the shop domain or anything else internal.
 */
export function toPublicCampaign(c: Campaign): PublicCampaign {
  const { content, design, rules, details } = campaignToInput(c);
  const publicContent: Partial<CampaignContent> = { ...content };
  for (const k of EMAIL_KEYS) delete publicContent[k];
  return {
    id: c.id,
    template: details.template,
    content: publicContent as PublicCampaign["content"],
    design,
    rules,
  };
}
