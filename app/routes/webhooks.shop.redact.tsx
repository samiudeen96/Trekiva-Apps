import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { logger } from "../utils/logger.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  await db.$transaction([
    db.welcomeOfferClaim.deleteMany({ where: { shopDomain: shop } }),
    db.campaign.deleteMany({ where: { shopDomain: shop } }),
    db.session.deleteMany({ where: { shop } }),
  ]);
  logger.info({ shop, topic }, "shop data redacted");

  return new Response();
};
