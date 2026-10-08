import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useNavigation, useSubmit } from "react-router";
import { authenticate } from "../shopify.server";
import { CLAIMS_PAGE_SIZE, MARKETING_FILTERS, STATUS_FILTERS, claimRepository } from "../repositories/claim.repository";
import { downloadClaimsCsv } from "../components/download-claims";
import { ConfirmModal } from "../components/ConfirmModal";
import { eligibilityLabel, emailBadge, handoffLabel } from "../claims/status";

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

  const { rows, total } = await claimRepository.list(session.shop, page, q, { status, marketing });
  return {
    page,
    q,
    status: status ?? "",
    marketing: marketing ?? "",
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
      eligibility: c.emailEligibility,
      viaFlow: c.delivery !== "APP",
      handoff: handoffLabel(c.flowHandoffAt, c.emailStatus, c.delivery),
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  if (form.get("intent") !== "delete") return { deleted: false };
  return { deleted: await claimRepository.delete(session.shop, String(form.get("id") ?? "")) };
};

export default function Claims() {
  const { claims, page, pages, total, q, status, marketing } = useLoaderData<typeof loader>();
  // Only claims made while Shopify Flow sent the email have a handoff; hide the column once none are on screen.
  const showHandoff = claims.some((c) => c.viaFlow);
  const navigate = useNavigate();
  const submit = useSubmit();
  const busy = useNavigation().state !== "idle";
  const [target, setTarget] = useState<{ id: string; email: string; discount: string } | null>(null);
  // Every control keeps the others' values, so changing one filter never drops the rest.
  const go = (p: number, next: { q?: string; status?: string; marketing?: string } = {}) => {
    const v = { q, status, marketing, ...next };
    navigate(
      `/app/claims?${new URLSearchParams({
        ...(v.q ? { q: v.q } : {}),
        ...(v.status ? { status: v.status } : {}),
        ...(v.marketing ? { marketing: v.marketing } : {}),
        page: String(p),
      })}`,
    );
  };
  const filtered = Boolean(q || status || marketing);

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
          <s-stack slot="filters" direction="inline" gap="small-200" alignItems="center">
            <s-search-field
              label="Search claims"
              labelAccessibilityVisibility="exclusive"
              placeholder="Search by email"
              value={q}
              onChange={(e: Event) => go(1, { q: (e.currentTarget as HTMLInputElement).value.trim() })}
            />
            <s-select
              label="Email status"
              labelAccessibilityVisibility="exclusive"
              value={status}
              onChange={(e: Event) => go(1, { status: (e.currentTarget as HTMLSelectElement).value })}
            >
              <s-option value="">All email statuses</s-option>
              <s-option value="sent">Email sent</s-option>
              <s-option value="pending">Pending</s-option>
              <s-option value="failed">Failed</s-option>
              <s-option value="flow">Flow (older claims)</s-option>
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
            {filtered && (
              <s-button variant="tertiary" onClick={() => navigate("/app/claims")}>
                Clear all
              </s-button>
            )}
          </s-stack>
          <s-table-header-row>
            <s-table-header listSlot="primary">Email</s-table-header>
            <s-table-header listSlot="secondary">Claimed</s-table-header>
            <s-table-header listSlot="inline">Email status</s-table-header>
            <s-table-header>Customer</s-table-header>
            <s-table-header>Campaign</s-table-header>
            <s-table-header>Discount</s-table-header>
            {showHandoff && <s-table-header>Flow handoff</s-table-header>}
            <s-table-header>Marketing</s-table-header>
            <s-table-header>Actions</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {claims.map((c) => (
              <s-table-row key={c.id}>
                <s-table-cell>{c.email}</s-table-cell>
                <s-table-cell>{new Date(c.claimedAt).toLocaleString()}</s-table-cell>
                <s-table-cell>
                  <s-badge tone={emailBadge(c.status, c.eligibility).tone}>
                    {emailBadge(c.status, c.eligibility).label}
                  </s-badge>
                </s-table-cell>
                <s-table-cell>
                  {c.customerId ? (
                    <s-link href={`shopify:admin/customers/${c.customerId}`} target="_top">View customer</s-link>
                  ) : "—"}
                </s-table-cell>
                <s-table-cell>{c.campaign}</s-table-cell>
                <s-table-cell>{c.discount}</s-table-cell>
                {showHandoff && <s-table-cell>{c.handoff}</s-table-cell>}
                <s-table-cell>{eligibilityLabel[c.eligibility]}</s-table-cell>
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
