import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { claimRepository } from "../repositories/claim.repository";
import { campaignRepository } from "../repositories/campaign.repository";
import { emailBadge } from "../claims/status";
import { emailConfig } from "../email/email.server";
import { delta, fillDays, summarizeDelivery, type DeliveryBucket } from "../dashboard/metrics";
import { ClaimsChart } from "../components/ClaimsChart";

const CHART_DAYS = 14;
const CAMPAIGNS_SHOWN = 5;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const [campaigns, stats, recent, daily, deliveryRows] = await Promise.all([
    campaignRepository.listWithClaimCounts(shopDomain),
    claimRepository.stats(shopDomain),
    claimRepository.recent(shopDomain, 5),
    claimRepository.dailyCounts(shopDomain, CHART_DAYS),
    claimRepository.deliveryCounts(shopDomain),
  ]);
  const activeCampaigns = campaigns.filter((c) => c.status === "ACTIVE").length;

  return {
    totalCampaigns: campaigns.length,
    activeCampaigns,
    totalClaims: stats.total,
    claimsToday: stats.today,
    claimsLast7Days: stats.last7Days,
    weekDelta: delta(stats.last7Days, stats.previous7Days),
    failedClaims: stats.failed,
    notSubscribedClaims: stats.notSubscribed,
    days: fillDays(daily, CHART_DAYS),
    delivery: summarizeDelivery(deliveryRows),
    campaigns: campaigns.slice(0, CAMPAIGNS_SHOWN).map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      claims: c._count.claims,
    })),
    setup: {
      hasCampaign: campaigns.length > 0,
      hasActive: activeCampaigns > 0,
      // Resend configured, or Flow has already received a claim: either way something delivers the email.
      hasDelivery: Boolean(emailConfig()) || stats.lastHandoffAt !== null,
      hasClaim: stats.total > 0,
    },
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

const n = (v: number) => v.toLocaleString("en-US");

// Status colours are fixed (good / warning / critical); "waiting" is neutral. Each segment is also named in the list.
const BUCKETS: { key: DeliveryBucket; label: string; hint: string; color: string }[] = [
  { key: "sent", label: "Code delivered", hint: "Emailed or applied instantly", color: "#0ca30c" },
  { key: "waiting", label: "Waiting for email", hint: "In progress", color: "#b5b5b0" },
  { key: "notSubscribed", label: "Not subscribed", hint: "Valid code, no marketing email", color: "#fab219" },
  { key: "failed", label: "Failed", hint: "Retry from Status", color: "#d03b3b" },
];

const STATUS_TONE = { ACTIVE: "success", DRAFT: "neutral", DISABLED: "warning" } as const;
const STATUS_LABEL = { ACTIVE: "Active", DRAFT: "Draft", DISABLED: "Disabled" } as const;

const bigNumber = { fontSize: 30, fontWeight: 650, lineHeight: 1.1, letterSpacing: "-0.02em" } as const;

function Tile(props: { label: string; icon: string; tone: "success" | "info" | "auto"; value: string; footer?: React.ReactNode }) {
  return (
    <s-box padding="base" background="subdued" borderWidth="base" borderRadius="large">
      <s-stack gap="small-200">
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-icon type={props.icon as never} tone={props.tone} />
          <s-text color="subdued">{props.label}</s-text>
        </s-stack>
        <span style={bigNumber}>{props.value}</span>
        {props.footer ?? <span style={{ height: 22 }} />}
      </s-stack>
    </s-box>
  );
}

export default function Dashboard() {
  const d = useLoaderData<typeof loader>();
  const deliveryTotal = BUCKETS.reduce((sum, b) => sum + d.delivery[b.key], 0);

  const actions = [
    { label: "Create campaign", detail: "Design a new popup and email", icon: "plus-circle", href: "/app/campaigns/new" },
    { label: "Campaigns", detail: "Edit, activate or pause", icon: "layout-popup", href: "/app/campaigns" },
    { label: "Claims", detail: "Search and export claims", icon: "email", href: "/app/claims" },
    { label: "Status", detail: "Health checks and failed claims", icon: "status-active", href: "/app/settings" },
  ] as const;

  const steps = [
    { done: d.setup.hasCampaign, title: "Create a campaign", detail: "Design the popup and pick your Shopify discount.", href: "/app/campaigns/new" },
    { done: d.setup.hasActive, title: "Activate it", detail: "Set the campaign to Active so the popup shows on your store.", href: "/app/campaigns" },
    { done: d.setup.hasDelivery, title: "Set up email delivery", detail: "Add your Resend key and sender address.", href: "/app/settings" },
    { done: d.setup.hasClaim, title: "Get your first claim", detail: "Submit the popup yourself with a new email to test it.", href: "/app/claims" },
  ];
  const stepsLeft = steps.filter((s) => !s.done).length;

  return (
    <s-page heading="Dashboard">
      <s-button slot="primary-action" variant="primary" icon="plus" href="/app/campaigns/new">
        Create campaign
      </s-button>

      {d.failedClaims > 0 && (
        <s-banner tone="critical" heading={`${d.failedClaims} claim(s) did not get their email yet`}>
          They will be retried automatically when the customer submits again, or use Retry in Status. Check
          Status for connection problems.
        </s-banner>
      )}
      {d.notSubscribedClaims > 0 && (
        <s-banner tone="warning" heading={`${d.notSubscribedClaims} claim(s) from customers who are not subscribed to email marketing`}>
          Their codes work, but Shopify Email does not send marketing email to customers who are not subscribed, so
          they may not have received their code. Sending the email from the app (Status) gives them a code-only email.
        </s-banner>
      )}
      {d.activeCampaigns === 0 && (
        <s-banner tone="info" heading="No active campaign">
          The popup is not showing on your store. Create a campaign and set its status to Active.
        </s-banner>
      )}

      {stepsLeft > 0 && (
        <s-section heading={`Get started: ${steps.length - stepsLeft} of ${steps.length} done`}>
          <s-stack gap="small-200">
            {steps.map((s) => (
              <s-stack key={s.title} direction="inline" gap="base" alignItems="center" justifyContent="space-between">
                <s-stack gap="none">
                  <s-text type="strong">{s.title}</s-text>
                  <s-text color="subdued">{s.detail}</s-text>
                </s-stack>
                {s.done ? <s-badge tone="success">Done</s-badge> : <s-link href={s.href}>Open</s-link>}
              </s-stack>
            ))}
          </s-stack>
        </s-section>
      )}

      <s-section>
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(190px, 1fr))" gap="base">
          <Tile label="Total claims" icon="discount" tone="success" value={n(d.totalClaims)} />
          <Tile label="Claims today" icon="calendar" tone="info" value={n(d.claimsToday)} />
          <Tile
            label="Last 7 days"
            icon="chart-line"
            tone="info"
            value={n(d.claimsLast7Days)}
            footer={
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-badge tone={d.weekDelta.tone}>{d.weekDelta.label}</s-badge>
                <s-text color="subdued">vs previous 7 days</s-text>
              </s-stack>
            }
          />
          <Tile label="Active campaigns" icon="megaphone" tone="auto" value={`${d.activeCampaigns} / ${d.totalCampaigns}`} />
        </s-grid>
      </s-section>

      <s-section heading="Claims per day">
        <ClaimsChart days={d.days} />
      </s-section>

      <s-section>
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(300px, 1fr))" gap="large">
          <s-stack gap="base">
            <s-heading>Email delivery</s-heading>
            {deliveryTotal === 0 ? (
              <s-text color="subdued">Nothing to show yet. Delivery appears here once customers claim.</s-text>
            ) : (
              <>
                <div
                  role="img"
                  aria-label={BUCKETS.map((b) => `${b.label}: ${d.delivery[b.key]}`).join(", ")}
                  style={{ display: "flex", gap: 2, height: 12, borderRadius: 6, overflow: "hidden" }}
                >
                  {BUCKETS.filter((b) => d.delivery[b.key] > 0).map((b) => (
                    <div key={b.key} style={{ flex: `${d.delivery[b.key]} 1 0`, minWidth: 4, background: b.color }} />
                  ))}
                </div>
                <s-stack gap="small-200">
                  {BUCKETS.map((b) => (
                    <div key={b.key} style={{ display: "flex", alignItems: "center", gap: 10, opacity: d.delivery[b.key] === 0 ? 0.55 : 1 }}>
                      <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: b.color, flex: "none" }} />
                      <span style={{ flex: 1 }}>
                        <s-text type="strong">{b.label}</s-text> <s-text color="subdued">{b.hint}</s-text>
                      </span>
                      <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{n(d.delivery[b.key])}</span>
                      <span style={{ width: 44, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#616161" }}>
                        {Math.round((d.delivery[b.key] / deliveryTotal) * 100)}%
                      </span>
                    </div>
                  ))}
                </s-stack>
              </>
            )}
          </s-stack>

          <s-stack gap="base">
            <s-heading>Campaigns</s-heading>
            {d.campaigns.length === 0 ? (
              <s-stack gap="small-200">
                <s-text color="subdued">No campaigns yet.</s-text>
                <s-link href="/app/campaigns/new">Create your first campaign</s-link>
              </s-stack>
            ) : (
              <s-stack gap="small-200">
                {d.campaigns.map((c) => (
                  <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
                    <s-stack direction="inline" gap="small-200" alignItems="center">
                      <s-link href={`/app/campaigns/${c.id}`}>{c.name}</s-link>
                      <s-badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</s-badge>
                    </s-stack>
                    <s-text color="subdued">
                      {n(c.claims)} {c.claims === 1 ? "claim" : "claims"}
                    </s-text>
                  </div>
                ))}
                {d.totalCampaigns > d.campaigns.length && <s-link href="/app/campaigns">View all campaigns</s-link>}
              </s-stack>
            )}
          </s-stack>
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
                      <s-badge tone={emailBadge(c.status, c.eligibility).tone}>{emailBadge(c.status, c.eligibility).label}</s-badge>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
            <s-link href="/app/claims">View all claims</s-link>
          </s-stack>
        )}
      </s-section>

      <s-section heading="Quick actions">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap="base">
          {actions.map((a) => (
            <s-clickable key={a.label} href={a.href} border="base" borderRadius="large" padding="base" inlineSize="100%">
              {/* Two fixed rows (icon, then text) so every card lays out identically. */}
              <s-grid gridTemplateColumns="1fr" gap="small-200" justifyItems="start" alignContent="start">
                <s-icon type={a.icon} />
                <s-grid gridTemplateColumns="1fr" gap="none">
                  <s-text type="strong">{a.label}</s-text>
                  <s-text color="subdued">{a.detail}</s-text>
                </s-grid>
              </s-grid>
            </s-clickable>
          ))}
        </s-grid>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
