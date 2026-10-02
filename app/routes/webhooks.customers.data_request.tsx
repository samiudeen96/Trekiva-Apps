import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { logger } from "../utils/logger.server";

// Data held per customer: claim rows (normalised email, discount code, timestamps).
// The merchant can export these from the Claims page; the request is logged for audit.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  logger.info(
    { shop, topic, customerId: payload?.customer?.id },
    "customer data request received",
  );
  return new Response();
};
