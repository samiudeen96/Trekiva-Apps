import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { normalizeEmail } from "../claims/email";
import { logger } from "../utils/logger.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  const customerId = payload?.customer?.id
    ? `gid://shopify/Customer/${payload.customer.id}`
    : null;
  const email =
    typeof payload?.customer?.email === "string"
      ? normalizeEmail(payload.customer.email)
      : null;

  const match = [
    ...(customerId ? [{ shopifyCustomerId: customerId }] : []),
    ...(email ? [{ emailNormalized: email }] : []),
  ];

  if (match.length > 0) {
    const { count } = await db.welcomeOfferClaim.deleteMany({
      where: { shopDomain: shop, OR: match },
    });
    logger.info({ shop, topic, deleted: count }, "customer claims redacted");
  }

  return new Response();
};
