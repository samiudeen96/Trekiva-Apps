import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { claimRepository } from "../repositories/claim.repository";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const [totalCampaigns, activeCampaigns, stats, recent] = await Promise.all([
    db.campaign.count({ where: { shopDomain } }),
    db.campaign.count({ where: { shopDomain, status: "ACTIVE" } }),
    claimRepository.stats(shopDomain),
    claimRepository.recent(shopDomain, 5),
  ]);

  return {
    totalCampaigns,
    activeCampaigns,
    totalClaims: stats.total,
    claimsToday: stats.today,
    claimsLast7Days: stats.last7Days,
    failedClaims: stats.failed,
    notSubscribedClaims: stats.notSubscribed,
    recent: recent.map((c) => ({
      id: c.id,
      email: c.emailNormalized,
      campaign: c.campaign.name,
      claimedAt: c.claimedAt.toISOString(),
    })),
  };
};

export default function Dashboard() {
  const d = useLoaderData<typeof loader>();
  const tiles = [
    ["Total campaigns", d.totalCampaigns],
    ["Active campaigns", d.activeCampaigns],
    ["Total claims", d.totalClaims],
    ["Claims today", d.claimsToday],
    ["Claims, last 7 days", d.claimsLast7Days],
  ] as const;

  return (
    <s-page heading="Trekiva">
      {d.failedClaims > 0 && (
        <s-banner tone="critical" heading={`${d.failedClaims} claim(s) did not reach Shopify Flow`}>
          Those customers did not get their email yet. They will be retried automatically when they submit
          again. Check Settings for connection problems.
        </s-banner>
      )}
      {d.notSubscribedClaims > 0 && (
        <s-banner tone="warning" heading={`${d.notSubscribedClaims} claim(s) from customers who unsubscribed from email marketing`}>
          Flow was triggered, but Shopify Email does not send marketing email to these customers, so they
          may not have received their code. They are marked Not subscribed on the Claims page.
        </s-banner>
      )}
      {d.activeCampaigns === 0 && (
        <s-banner tone="info" heading="No active campaign">
          The popup is not showing on your store. Create a campaign and set its status to Active.
        </s-banner>
      )}
      <s-section heading="Overview">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))" gap="base">
          {tiles.map(([label, value]) => (
            <s-box key={label} padding="base" borderWidth="base" borderRadius="base">
              <s-stack gap="small-200">
                <s-text color="subdued">{label}</s-text>
                <s-heading>{value}</s-heading>
              </s-stack>
            </s-box>
          ))}
        </s-grid>
      </s-section>
      <s-section heading="Recent claims">
        {d.recent.length === 0 ? (
          <s-text color="subdued">No claims yet.</s-text>
        ) : (
          <s-stack gap="small-200">
            {d.recent.map((c) => (
              <s-text key={c.id}>
                {c.email} · {c.campaign} · {new Date(c.claimedAt).toLocaleString()}
              </s-text>
            ))}
            <s-link href="/app/claims">View all claims</s-link>
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
