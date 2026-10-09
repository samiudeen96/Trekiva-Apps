import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { revokeCodesUsedByOrder } from "../orders/redemption.server";
import { logger } from "../utils/logger.server";

/**
 * Takes a claim's code out of circulation once an order has used it.
 *
 * Shopify's "limit 1 use" only counts redemptions its own checkout makes. A checkout app that
 * works the discount out itself leaves the code unused, so the same code can buy any number of
 * orders. This closes that: see app/orders/redemption.server.ts.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, admin } = await authenticate.webhook(request);
  if (!admin) return new Response();

  try {
    await revokeCodesUsedByOrder(admin, shop, payload);
  } catch (err) {
    // Answer with an error so Shopify sends the webhook again (it retries for several hours). Every step
    // is safe to repeat, and leaving the code live after an order is exactly what this exists to prevent.
    logger.error({ err, shop }, "could not revoke the claim code used by an order; Shopify will retry");
    return new Response(null, { status: 500 });
  }
  return new Response();
};
