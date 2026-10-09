import { useState, useSyncExternalStore } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useNavigation, useSubmit } from "react-router";
import { authenticate } from "../shopify.server";
import { CLAIMS_PAGE_SIZE, CLAIM_SORTS, MARKETING_FILTERS, STATUS_FILTERS, claimRepository } from "../repositories/claim.repository";
import { downloadClaimsCsv } from "../components/download-claims";
import { ConfirmModal } from "../components/ConfirmModal";
import { eligibilityLabel, emailBadge } from "../claims/status";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const q = url.searchParams.get("q") ?? "";

  // Unknown filter values from the address bar are ignored, never passed to the query.
  const statusParam = url.searchParams.get("status") ?? "";
  const marketingParam = url.searchParams.get("marketing") ?? "";
  const status = statusParam in STATUS_FILTERS ? (statusParam as keyof typeof STATUS_FILTERS) : undefined;
  const marketing = (MARKETING_FILTERS as readonly string[]).includes(marketingParam)
    ? (marketingParam as (typeof MARKETING_FILTERS)[number])
    : undefined;

  const sortParam = url.searchParams.get("sort") ?? "";
  const sort = (CLAIM_SORTS as readonly string[]).includes(sortParam) ? (sortParam as (typeof CLAIM_SORTS)[number]) : undefined;

  const { rows, total } = await claimRepository.list(session.shop, page, q, { status, marketing, sort });
  return {
    page,
    q,
    status: status ?? "",
    marketing: marketing ?? "",
    sort: sort ?? "newest",
    total,
    pages: Math.max(1, Math.ceil(total / CLAIMS_PAGE_SIZE)),
    claims: rows.map((c) => ({
      id: c.id,
      email: c.emailNormalized,
      customerId: c.shopifyCustomerId?.split("/").pop() ?? null,
      campaign: c.campaign.name,
      discount: c.discountCode,
      claimedAt: c.claimedAt.toISOString(),
      status: c.emailStatus,
      redeemed: c.redeemedAt !== null,
      eligibility: c.emailEligibility,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  if (form.get("intent") !== "delete") return { deleted: false };
  return { deleted: await claimRepository.delete(session.shop, String(form.get("id") ?? "")) };
};

const COLUMNS_KEY = "trekiva:claims-columns";
const COLUMNS = [
  { key: "claimed", label: "Claimed" },
  { key: "status", label: "Email status" },
  { key: "marketing", label: "Marketing" },
  { key: "discount", label: "Discount code" },
  { key: "code", label: "Code status" },
  { key: "campaign", label: "Campaign" },
];
const DEFAULT_KEY = "claimed,status,marketing,discount,code";
const COLUMNS_EVENT = "trekiva:claims-columns";
function subscribeColumns(cb: () => void) {
  window.addEventListener(COLUMNS_EVENT, cb);
  return () => window.removeEventListener(COLUMNS_EVENT, cb);
}
function readColumns() {
  try {
    const v = window.localStorage.getItem(COLUMNS_KEY);
    return v === null ? DEFAULT_KEY : v;
  } catch {
    return DEFAULT_KEY;
  }
}
const shortDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export default function Claims() {
  const { claims, page, pages, total, q, status, marketing, sort } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const submit = useSubmit();
  const busy = useNavigation().state !== "idle";
  const [target, setTarget] = useState<{ id: string; email: string; discount: string } | null>(null);
  // Every control keeps the others' values, so changing one filter never drops the rest.
  const go = (p: number, next: { q?: string; status?: string; marketing?: string; sort?: string } = {}) => {
    const v = { q, status, marketing, sort, ...next };
    navigate(
      `/app/claims?${new URLSearchParams({
        ...(v.q ? { q: v.q } : {}),
        ...(v.status ? { status: v.status } : {}),
        ...(v.marketing ? { marketing: v.marketing } : {}),
        ...(v.sort && v.sort !== "newest" ? { sort: v.sort } : {}),
        page: String(p),
      })}`,
    );
  };
  const filtered = Boolean(q || status || marketing);

  // Which optional columns show. Email and Actions always do. Remembered per browser, never required.
  const saved = useSyncExternalStore(subscribeColumns, readColumns, () => DEFAULT_KEY);
  const shown = saved.split(",").filter(Boolean);
  const toggle = (key: string, on: boolean) => {
    const next = COLUMNS.map((c) => c.key).filter((k) => (k === key ? on : shown.includes(k)));
    try { window.localStorage.setItem(COLUMNS_KEY, next.join(",")); } catch { /* ignore */ }
    window.dispatchEvent(new Event(COLUMNS_EVENT));
  };
  const has = (key: string) => shown.includes(key);

  return (
    <s-page heading="Claims">
      <s-button slot="secondary-actions" onClick={() => void downloadClaimsCsv()}>
        Export CSV
      </s-button>
      <s-section padding="none">
        <s-box padding="base">
          <s-text color="subdued">
            Deleting a claim removes it from Trekiva only. The Shopify customer and the discount code
            stay, and that email can claim the offer again.
          </s-text>
        </s-box>
        {/* Filters and view options sit above the table: its own filter slot takes only the search bar. */}
        <s-box paddingInline="base" paddingBlockEnd="base">
          <s-grid gridTemplateColumns="1fr 1fr auto" gap="small-200" alignItems="center">
            <s-select
              label="Email status"
              labelAccessibilityVisibility="exclusive"
              value={status}
              onChange={(e: Event) => go(1, { status: (e.currentTarget as HTMLSelectElement).value })}
            >
              <s-option value="">All email statuses</s-option>
              <s-option value="sent">Email sent</s-option>
              <s-option value="applied">Applied instantly</s-option>
              <s-option value="pending">Pending</s-option>
              <s-option value="failed">Failed</s-option>
              <s-option value="flow">Sent by Flow (older)</s-option>
            </s-select>
            <s-select
              label="Marketing"
              labelAccessibilityVisibility="exclusive"
              value={marketing}
              onChange={(e: Event) => go(1, { marketing: (e.currentTarget as HTMLSelectElement).value })}
            >
              <s-option value="">All marketing</s-option>
              <s-option value="SUBSCRIBED">Subscribed</s-option>
              <s-option value="NOT_SUBSCRIBED">Not subscribed</s-option>
              <s-option value="UNKNOWN">Unknown</s-option>
            </s-select>
            <s-stack direction="inline" gap="small-200" alignItems="center">
              {filtered && (
                <s-button variant="tertiary" onClick={() => navigate("/app/claims")}>
                  Clear all
                </s-button>
              )}
              <s-button icon="sort" accessibilityLabel="Sort and choose columns" commandFor="claims-view" />
            </s-stack>
            <s-popover id="claims-view">
              <s-box padding="base" inlineSize="260px">
                <s-stack gap="base">
                  <s-select
                    label="Sort by"
                    value={sort}
                    onChange={(e: Event) => go(1, { sort: (e.currentTarget as HTMLSelectElement).value })}
                  >
                    <s-option value="newest">Newest first</s-option>
                    <s-option value="oldest">Oldest first</s-option>
                    <s-option value="email">Email (A to Z)</s-option>
                  </s-select>
                  <s-stack gap="small-300">
                    <s-text type="strong">Columns</s-text>
                    {COLUMNS.map((c) => (
                      <s-checkbox
                        key={c.key}
                        label={c.label}
                        checked={has(c.key)}
                        onChange={(e: Event) => toggle(c.key, (e.currentTarget as HTMLInputElement).checked)}
                      />
                    ))}
                  </s-stack>
                </s-stack>
              </s-box>
            </s-popover>
          </s-grid>
        </s-box>
        {/* Shopify's own table: search lives in its filters slot, paging in its footer. */}
        <s-table
          variant="auto"
          paginate
          hasPreviousPage={page > 1}
          hasNextPage={page < pages}
          onPreviousPage={() => go(page - 1)}
          onNextPage={() => go(page + 1)}
          {...(busy ? { loading: true } : {})}
        >
          <s-search-field
            slot="filters"
            label="Search claims"
            labelAccessibilityVisibility="exclusive"
            placeholder="Search by email"
            value={q}
            onChange={(e: Event) => go(1, { q: (e.currentTarget as HTMLInputElement).value.trim() })}
          />
          <s-table-header-row>
            <s-table-header listSlot="primary">Email</s-table-header>
            {has("claimed") && <s-table-header listSlot="secondary">Claimed</s-table-header>}
            {has("status") && <s-table-header listSlot="inline">Email status</s-table-header>}
            {has("marketing") && <s-table-header>Marketing</s-table-header>}
            {has("discount") && <s-table-header>Discount code</s-table-header>}
            {has("code") && <s-table-header>Code status</s-table-header>}
            {has("campaign") && <s-table-header>Campaign</s-table-header>}
            <s-table-header>Actions</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {claims.map((c) => (
              <s-table-row key={c.id}>
                <s-table-cell>
                  {/* Like the Customers list: the name is the link to the customer. */}
                  {c.customerId ? (
                    <s-link href={`shopify:admin/customers/${c.customerId}`} target="_top">{c.email}</s-link>
                  ) : (
                    c.email
                  )}
                </s-table-cell>
                {has("claimed") && <s-table-cell>{shortDate(c.claimedAt)}</s-table-cell>}
                {has("status") && (
                  <s-table-cell>
                    <s-badge tone={emailBadge(c.status, c.eligibility).tone}>
                      {emailBadge(c.status, c.eligibility).label}
                    </s-badge>
                  </s-table-cell>
                )}
                {has("marketing") && <s-table-cell>{eligibilityLabel[c.eligibility]}</s-table-cell>}
                {has("discount") && <s-table-cell>{c.discount}</s-table-cell>}
                {has("code") && (
                  <s-table-cell>
                    {/* "Used" means an order spent it and the code was pulled from the discount. */}
                    <s-badge tone={c.redeemed ? "neutral" : "success"}>
                      {c.redeemed ? "Used" : "Unused"}
                    </s-badge>
                  </s-table-cell>
                )}
                {has("campaign") && <s-table-cell>{c.campaign}</s-table-cell>}
                <s-table-cell>
                  <s-button tone="critical" variant="tertiary" onClick={() => setTarget({ id: c.id, email: c.email, discount: c.discount })}>
                    Delete
                  </s-button>
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
        {claims.length === 0 && (
          <s-box padding="large">
            <s-text>{filtered ? "No claims match your search or filters." : "No claims yet."}</s-text>
          </s-box>
        )}
        <s-box padding="base">
          <s-text color="subdued">{total} claim{total === 1 ? "" : "s"}</s-text>
        </s-box>
      </s-section>

      <ConfirmModal
        open={target !== null}
        heading={`Delete claim for ${target?.email ?? ""}?`}
        confirmLabel="Delete claim"
        destructive
        busy={busy}
        onClose={() => setTarget(null)}
        onConfirm={() => target && submit({ intent: "delete", id: target.id }, { method: "post" })}
      >
        <s-stack gap="small-200">
          <s-text>
            This removes the claim from Trekiva only. The Shopify customer and the discount code{" "}
            <s-text type="strong">{target?.discount}</s-text> stay in Shopify.
          </s-text>
          <s-text color="subdued">That email will be able to claim the offer again.</s-text>
        </s-stack>
      </ConfirmModal>
    </s-page>
  );
}
