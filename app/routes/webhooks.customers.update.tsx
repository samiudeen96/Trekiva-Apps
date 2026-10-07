import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { claimRepository } from "../repositories/claim.repository";
import { hasEmailSentTag } from "../shopify/handoff.server";
import { logger } from "../utils/logger.server";

/**
 * Keeps the admin's "Email sent" status in step with Flow, which adds trekiva_welcome_email_sent
 * after its email action. This fires for EVERY customer update in the shop, so it answers from
 * the database first and only asks Shopify about customers that have a claim waiting for Flow.
 * The payload's tag list is not relied on: one targeted tag read is cheap and unambiguous.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, admin } = await authenticate.webhook(request);

  const customerId = payload?.admin_graphql_api_id
    ? String(payload.admin_graphql_api_id)
    : payload?.id
      ? `gid://shopify/Customer/${payload.id}`
      : null;
  if (!customerId || !admin) return new Response();

  try {
    if (!(await claimRepository.hasPendingHandoff(shop, customerId))) return new Response();
    if (await hasEmailSentTag(admin, customerId)) {
      const updated = await claimRepository.markEmailSent(shop, customerId);
      logger.info({ shop, updated }, "welcome email marked sent by Flow tag");
    }
  } catch (err) {
    // Status sync is best effort: never fail the webhook (Shopify would retry and pile up).
    logger.warn({ err, shop }, "could not sync email-sent tag");
  }
  return new Response();
};
