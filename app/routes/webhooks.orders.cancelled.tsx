import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { restoreCodesFromOrder } from "../orders/redemption.server";
import { logger } from "../utils/logger.server";

/** Gives a claim's code back when the order that spent it is cancelled (common with COD returns). */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, admin } = await authenticate.webhook(request);
  if (!admin) return new Response();

  try {
    await restoreCodesFromOrder(admin, shop, payload);
  } catch (err) {
    logger.warn({ err, shop }, "could not restore the claim code after a cancellation");
  }
  return new Response();
};
