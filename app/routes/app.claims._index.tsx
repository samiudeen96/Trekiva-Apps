import { useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useNavigation, useSubmit } from "react-router";
import { authenticate } from "../shopify.server";
import { CLAIMS_PAGE_SIZE, claimRepository } from "../repositories/claim.repository";
import { downloadClaimsCsv } from "../components/download-claims";
import { eligibilityLabel, emailBadge, handoffLabel } from "../claims/status";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const q = url.searchParams.get("q") ?? "";

  const { rows, total } = await claimRepository.list(session.shop, page, q);
  return {
    page,
    q,
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
      handoff: handoffLabel(c.flowHandoffAt, c.emailStatus),
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
  const { claims, page, pages, total, q } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const submit = useSubmit();
  const deleting = useNavigation().state === "submitting";
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const search = useRef<{ value?: string } | null>(null);
  const go = (p: number, term = q) =>
    navigate(`/app/claims?${new URLSearchParams({ ...(term ? { q: term } : {}), page: String(p) })}`);

  return (
    <s-page heading="Claims">
      <s-button slot="secondary-actions" onClick={() => void downloadClaimsCsv()}>
        Export CSV
      </s-button>
      <s-section padding="none">
        <s-box padding="base">
          <s-stack direction="inline" gap="small-200" alignItems="end">
            <s-text-field ref={(el) => { search.current = el; }} label="Search by email" labelAccessibilityVisibility="exclusive" placeholder="Search by email" value={q} />
            <s-button onClick={() => go(1, search.current?.value?.trim() ?? "")}>Search</s-button>
            {q && <s-button variant="tertiary" onClick={() => go(1, "")}>Clear</s-button>}
          </s-stack>
        </s-box>
        <s-box paddingInline="base" paddingBlockEnd="base">
          <s-text color="subdued">
            Deleting a claim removes it from Trekiva only. The Shopify customer and the discount code
            stay, and that email can claim the offer again.
          </s-text>
        </s-box>
        {claims.length === 0 ? (
          <s-box padding="large">
            <s-text>{q ? "No claims match your search." : "No claims yet."}</s-text>
          </s-box>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Email</s-table-header>
              <s-table-header>Customer</s-table-header>
              <s-table-header>Campaign</s-table-header>
              <s-table-header>Discount</s-table-header>
              <s-table-header>Claimed</s-table-header>
              <s-table-header>Flow handoff</s-table-header>
              <s-table-header>Email</s-table-header>
              <s-table-header>Marketing</s-table-header>
              <s-table-header>Actions</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {claims.map((c) => (
                <s-table-row key={c.id}>
                  <s-table-cell>{c.email}</s-table-cell>
                  <s-table-cell>
                    {c.customerId ? (
                      <s-link href={`shopify:admin/customers/${c.customerId}`} target="_top">View customer</s-link>
                    ) : "—"}
                  </s-table-cell>
                  <s-table-cell>{c.campaign}</s-table-cell>
                  <s-table-cell>{c.discount}</s-table-cell>
                  <s-table-cell>{new Date(c.claimedAt).toLocaleString()}</s-table-cell>
                  <s-table-cell>{c.handoff}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={emailBadge(c.status, c.eligibility).tone}>
                      {emailBadge(c.status, c.eligibility).label}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>{eligibilityLabel[c.eligibility]}</s-table-cell>
                  <s-table-cell>
                    {confirmId === c.id ? (
                      <s-stack direction="inline" gap="small-200">
                        <s-button
                          tone="critical"
                          variant="primary"
                          onClick={() => {
                            setConfirmId(null);
                            submit({ intent: "delete", id: c.id }, { method: "post" });
                          }}
                          {...(deleting ? { loading: true } : {})}
                        >
                          Confirm delete
                        </s-button>
                        <s-button onClick={() => setConfirmId(null)}>Cancel</s-button>
                      </s-stack>
                    ) : (
                      <s-button tone="critical" variant="tertiary" onClick={() => setConfirmId(c.id)}>
                        Delete
                      </s-button>
                    )}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
        <s-box padding="base">
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-button disabled={page <= 1} onClick={() => go(page - 1)}>Previous</s-button>
            <s-text>Page {page} of {pages} · {total} claim{total === 1 ? "" : "s"}</s-text>
            <s-button disabled={page >= pages} onClick={() => go(page + 1)}>Next</s-button>
          </s-stack>
        </s-box>
      </s-section>
    </s-page>
  );
}
