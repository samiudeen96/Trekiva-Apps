import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { claimRepository } from "../repositories/claim.repository";
import { emailBadge } from "../claims/status";

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
      status: c.emailStatus,
      eligibility: c.emailEligibility,
      claimedAt: c.claimedAt.toISOString(),
    })),
  };
};

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export default function Dashboard() {
  const d = useLoaderData<typeof loader>();
  const tiles = [
    { label: "Total claims", value: d.totalClaims, icon: "discount", tone: "success" },
    { label: "Claims today", value: d.claimsToday, icon: "calendar", tone: "info" },
    { label: "Last 7 days", value: d.claimsLast7Days, icon: "chart-line", tone: "info" },
    { label: "Active campaigns", value: `${d.activeCampaigns} / ${d.totalCampaigns}`, icon: "megaphone", tone: "auto" },
  ] as const;
  const actions = [
    { label: "Create campaign", detail: "Design a new popup", icon: "plus-circle", href: "/app/campaigns/new" },
    { label: "Campaigns", detail: "Edit, activate or pause", icon: "layout-popup", href: "/app/campaigns" },
    { label: "Claims", detail: "Search and export claims", icon: "email", href: "/app/claims" },
    { label: "Settings", detail: "Check Flow and connections", icon: "settings", href: "/app/settings" },
  ] as const;

  return (
    <s-page heading="Trekiva">
      <s-button slot="primary-action" variant="primary" icon="plus" href="/app/campaigns/new">
        Create campaign
      </s-button>
      {d.failedClaims > 0 && (
        <s-banner tone="critical" heading={`${d.failedClaims} claim(s) were not handed over to Shopify Flow`}>
          Those customers have no email yet. They will be retried automatically when they submit
          again, or use Retry in Settings. Check Settings for connection problems.
        </s-banner>
      )}
      {d.notSubscribedClaims > 0 && (
        <s-banner tone="warning" heading={`${d.notSubscribedClaims} claim(s) from customers who are not subscribed to email marketing`}>
          Their claims are valid and their codes work, but Shopify Email does not send marketing email to
          customers who are not subscribed, so they may not have received their code. They are marked Not
          subscribed on the Claims page.
        </s-banner>
      )}
      {d.activeCampaigns === 0 && (
        <s-banner tone="info" heading="No active campaign">
          The popup is not showing on your store. Create a campaign and set its status to Active.
        </s-banner>
      )}

      <s-section>
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(190px, 1fr))" gap="base">
          {tiles.map((t) => (
            <s-box key={t.label} padding="base" background="subdued" borderWidth="base" borderRadius="large">
              <s-stack gap="base">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-icon type={t.icon} tone={t.tone} />
                  <s-text color="subdued">{t.label}</s-text>
                </s-stack>
                <s-heading>{t.value}</s-heading>
              </s-stack>
            </s-box>
          ))}
        </s-grid>
      </s-section>

      <s-section heading="Quick actions">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap="base">
          {actions.map((a) => (
            <s-clickable key={a.label} href={a.href} border="base" borderRadius="large" padding="base">
              <s-stack direction="inline" gap="base" alignItems="center">
                <s-icon type={a.icon} />
                <s-stack gap="none">
                  <s-text type="strong">{a.label}</s-text>
                  <s-text color="subdued">{a.detail}</s-text>
                </s-stack>
              </s-stack>
            </s-clickable>
          ))}
        </s-grid>
      </s-section>

      <s-section heading="Recent claims">
        {d.recent.length === 0 ? (
          <s-stack gap="small-200" alignItems="center">
            <s-icon type="email-follow-up" tone="info" size="base" />
            <s-text type="strong">No claims yet</s-text>
            <s-text color="subdued">Claims show up here as soon as a visitor submits the popup.</s-text>
          </s-stack>
        ) : (
          <s-stack gap="base">
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Email</s-table-header>
                <s-table-header>Campaign</s-table-header>
                <s-table-header>Claimed</s-table-header>
                <s-table-header>Email status</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {d.recent.map((c) => (
                  <s-table-row key={c.id}>
                    <s-table-cell>{c.email}</s-table-cell>
                    <s-table-cell>{c.campaign}</s-table-cell>
                    <s-table-cell>{timeAgo(c.claimedAt)}</s-table-cell>
                    <s-table-cell>
                      <s-badge tone={emailBadge(c.status, c.eligibility).tone}>
                        {emailBadge(c.status, c.eligibility).label}
                      </s-badge>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
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
