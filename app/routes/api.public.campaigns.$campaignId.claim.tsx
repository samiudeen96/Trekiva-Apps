import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { authenticate } from "../shopify.server";
import { ClaimService } from "../claims/claim.service";
import { CampaignUnavailableError, InvalidEmailError } from "../claims/types";
import { createCustomerGateway } from "../shopify/customers.server";
import { createFlowGateway } from "../flow/flow.server";
import { allowClaimAttempt, clientIp } from "../utils/rate-limit.server";
import { logger } from "../utils/logger.server";

const bodySchema = z.object({ email: z.string().max(254) });

const json = (body: object, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

// Reached through the Shopify app proxy: /apps/trekiva/campaigns/:id/claim
export const action = async ({ request, params }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ status: "error", message: "Method not allowed" }, 405);
  }

  // Verifies Shopify's proxy signature; throws a 4xx Response if invalid.
  const { session, admin } = await authenticate.public.appProxy(request);
  if (!session || !admin) return json({ status: "error", message: "App not installed" }, 401);

  if (!(await allowClaimAttempt(session.shop, clientIp(request)))) {
    return json({ status: "error", message: "Too many attempts. Please try again shortly." }, 429);
  }

  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return json({ status: "error", message: "Please enter a valid email address." }, 400);
  }

  const claimService = new ClaimService(
    createCustomerGateway(admin),
    createFlowGateway(admin),
  );
  try {
    const outcome = await claimService.claim({
      shopDomain: session.shop,
      campaignId: params.campaignId!,
      email: body.data.email,
    });
    return json(outcome);
  } catch (err) {
    if (err instanceof InvalidEmailError) {
      return json({ status: "error", message: "Please enter a valid email address." }, 400);
    }
    if (err instanceof CampaignUnavailableError) {
      return json({ status: "error", message: "This offer is not available." }, 404);
    }
    logger.error({ err, shop: session.shop }, "claim request failed");
    return json({ status: "error", message: "Something went wrong. Please try again." }, 500);
  }
};
