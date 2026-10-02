import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { toPublicCampaign } from "../campaigns/public";

const headers = { "Cache-Control": "private, max-age=30" };

// Reached through the app proxy: GET /apps/trekiva/campaigns/active
// Returns the newest ACTIVE campaign that has a discount, or { campaign: null }.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  if (!session) return Response.json({ campaign: null }, { status: 401 });

  const campaign = await db.campaign.findFirst({
    where: { shopDomain: session.shop, status: "ACTIVE", discountCode: { not: null } },
    orderBy: { updatedAt: "desc" },
  });

  return Response.json({ campaign: campaign ? toPublicCampaign(campaign) : null }, { headers });
};
