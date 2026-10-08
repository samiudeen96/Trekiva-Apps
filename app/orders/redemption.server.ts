import { createDiscountCodeGateway, revokeClaimCode } from "../discounts/redeem-codes.server";
import type { AdminGraphqlClient } from "../discounts/types";
import { claimRepository } from "../repositories/claim.repository";
import { logger } from "../utils/logger.server";
import { redeemedCodeCandidates } from "./redeemed-codes";

/** The order's GID, or null when the payload has no usable id. */
export function orderGid(payload: { admin_graphql_api_id?: unknown; id?: unknown }): string | null {
  if (typeof payload?.admin_graphql_api_id === "string") return payload.admin_graphql_api_id;
  const id = payload?.id;
  return typeof id === "number" || typeof id === "string" ? `gid://shopify/Order/${id}` : null;
}

/**
 * An order used a claim's code, so that code is pulled from the Shopify discount: one code can
 * then only ever buy one order, even when the checkout never redeemed it with Shopify.
 *
 * Only codes this shop issued through Trekiva are considered, and each is deleted only from the
 * discount its own campaign points at. Every other code in the order is left alone.
 */
export async function revokeCodesUsedByOrder(
  admin: AdminGraphqlClient,
  shopDomain: string,
  payload: unknown,
) {
  const orderId = orderGid((payload ?? {}) as { admin_graphql_api_id?: unknown; id?: unknown });
  if (!orderId) return;

  const candidates = redeemedCodeCandidates(payload);
  const claims = await claimRepository.findIssuedCodes(shopDomain, candidates);

  for (const claim of claims) {
    // Another order already spent this code (or this webhook is a repeat): leave it as it is.
    if (claim.redeemedAt) continue;
    const discountId = claim.campaign.discountId;
    if (!discountId) continue;

    // Recorded first: if the delete then fails, the admin still shows the code as spent and a
    // retry of this webhook will try the delete again.
    await claimRepository.markRedeemed(shopDomain, claim.id, orderId);
    const result = await revokeClaimCode(admin, { discountId, code: claim.discountCode });
    logger.info({ shopDomain, orderId, code: claim.discountCode, result }, "claim code revoked after order");
  }
}

/**
 * The order that spent a code was cancelled, so the code goes back. COD orders are cancelled and
 * returned often, and the customer never received the goods: taking their welcome offer away for
 * an order that did not happen would be wrong.
 */
export async function restoreCodesFromOrder(
  admin: AdminGraphqlClient,
  shopDomain: string,
  payload: unknown,
) {
  const orderId = orderGid((payload ?? {}) as { admin_graphql_api_id?: unknown; id?: unknown });
  if (!orderId) return;

  const candidates = redeemedCodeCandidates(payload);
  const claims = await claimRepository.findIssuedCodes(shopDomain, candidates);
  const gateway = createDiscountCodeGateway(admin);

  for (const claim of claims) {
    // Only the order that spent the code may give it back.
    if (claim.redeemedOrderId !== orderId) continue;
    const discountId = claim.campaign.discountId;
    if (!discountId) continue;

    // issueCode is idempotent, so a repeated cancellation webhook is harmless.
    await gateway.issueCode({ discountId, code: claim.discountCode });
    await claimRepository.clearRedeemed(shopDomain, claim.id, orderId);
    logger.info({ shopDomain, orderId, code: claim.discountCode }, "claim code restored after cancellation");
  }
}
