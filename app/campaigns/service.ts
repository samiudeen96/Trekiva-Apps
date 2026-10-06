import type { Campaign } from "@prisma/client";
import { getCodeDiscount } from "../discounts/discounts.server";
import type { AdminGraphqlClient } from "../discounts/types";
import { campaignRepository, type DiscountRef } from "../repositories/campaign.repository";
import { defaultCampaign } from "./defaults";
import type { CampaignInput } from "./schema";

export { parseCampaignForm } from "./form";
export type { FieldErrors, ParseResult } from "./form";
import type { FieldErrors } from "./form";

/** Rehydrates a stored campaign, filling any missing keys from defaults. */
export function campaignToInput(c: Campaign): CampaignInput {
  return {
    discountId: c.discountId,
    details: { name: c.name, status: c.status, template: c.template },
    content: { ...defaultCampaign.content, ...(c.content as object) },
    design: { ...defaultCampaign.design, ...(c.design as object) },
    rules: { ...defaultCampaign.rules, ...(c.rules as object) },
  };
}

/**
 * Re-checks the selected discount against Shopify (never trusts the browser)
 * and enforces: an ACTIVE campaign needs a live, existing discount.
 */
async function resolveDiscount(
  admin: AdminGraphqlClient,
  input: CampaignInput,
): Promise<{ ok: true; discount: DiscountRef | null } | { ok: false; errors: FieldErrors }> {
  if (!input.discountId) {
    return input.details.status === "ACTIVE"
      ? { ok: false, errors: { discountId: "Select a Shopify discount before activating" } }
      : { ok: true, discount: null };
  }
  const found = await getCodeDiscount(admin, input.discountId);
  if (!found) return { ok: false, errors: { discountId: "Discount not found in Shopify" } };
  if (input.details.status === "ACTIVE" && found.status === "EXPIRED") {
    return { ok: false, errors: { discountId: "This discount has expired" } };
  }
  return { ok: true, discount: { id: found.id, code: found.code, title: found.title } };
}

export type SaveResult<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

export const campaignService = {
  list: campaignRepository.listWithClaimCounts,
  get: campaignRepository.findById,
  remove: campaignRepository.remove,

  async create(shopDomain: string, admin: AdminGraphqlClient, input: CampaignInput): Promise<SaveResult<Campaign>> {
    const r = await resolveDiscount(admin, input);
    if (!r.ok) return r;
    return { ok: true, value: await campaignRepository.create(shopDomain, input, r.discount) };
  },

  /** value is false when the campaign does not belong to this shop. */
  async update(shopDomain: string, admin: AdminGraphqlClient, id: string, input: CampaignInput): Promise<SaveResult<boolean>> {
    const r = await resolveDiscount(admin, input);
    if (!r.ok) return r;
    return { ok: true, value: await campaignRepository.update(shopDomain, id, input, r.discount) };
  },
};
