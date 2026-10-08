import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData, useNavigation, useSubmit } from "react-router";
import { authenticate } from "../shopify.server";
import { campaignService } from "../campaigns/service";
import { ConfirmModal } from "../components/ConfirmModal";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const campaigns = await campaignService.list(session.shop);
  return {
    campaigns: campaigns.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      template: c.template,
      discount: c.discountCode ?? "—",
      claims: c._count.claims,
      createdAt: c.createdAt.toISOString(),
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  if (form.get("intent") !== "delete") return { error: null, deleted: null };

  const result = await campaignService.remove(session.shop, String(form.get("id") ?? ""));
  if (result.ok) return { error: null, deleted: result.claimsDeleted };
  return {
    error:
      result.reason === "ACTIVE"
        ? "This campaign is active. Set it to Draft first, then delete it."
        : "That campaign no longer exists.",
    deleted: null,
  };
};

const tone = { ACTIVE: "success", DRAFT: "neutral", DISABLED: "critical" } as const;
const templateLabel = {
  SPLIT_IMAGE: "Split image",
  CENTERED_MINIMAL: "Centered minimal",
  IMAGE_BANNER: "Image banner",
} as const;

export default function Campaigns() {
  const { campaigns } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const submit = useSubmit();
  const deleting = useNavigation().state === "submitting";
  // The row awaiting confirmation, and the active campaign the merchant tried to delete.
  const [target, setTarget] = useState<{ id: string; name: string; claims: number } | null>(null);
  const [blocked, setBlocked] = useState<{ id: string; name: string } | null>(null);

  const askDelete = (c: (typeof campaigns)[number]) => {
    if (c.status === "ACTIVE") {
      setTarget(null);
      setBlocked({ id: c.id, name: c.name });
    } else {
      setBlocked(null);
      setTarget({ id: c.id, name: c.name, claims: c.claims });
    }
  };

  return (
    <s-page heading="Campaigns">
      <s-button slot="primary-action" variant="primary" href="/app/campaigns/new">
        Create campaign
      </s-button>
      {blocked && (
        <s-banner tone="warning" heading={`"${blocked.name}" is active`} dismissible onDismiss={() => setBlocked(null)}>
          <s-stack gap="small-200">
            <s-text>An active campaign can&apos;t be deleted. Set its status to Draft first, then delete it.</s-text>
            <s-link href={`/app/campaigns/${blocked.id}`}>Open campaign to set it to Draft</s-link>
          </s-stack>
        </s-banner>
      )}
      {result?.error && <s-banner tone="critical">{result.error}</s-banner>}
      {result?.deleted !== null && result?.deleted !== undefined && (
        <s-banner tone="success">
          Campaign deleted{result.deleted > 0 ? ` along with its ${result.deleted} claim(s)` : ""}.
        </s-banner>
      )}
      <s-section padding="none">
        {campaigns.length === 0 ? (
          <s-box padding="large">
            <s-text>No campaigns yet. Create your first welcome popup.</s-text>
          </s-box>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Name</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Template</s-table-header>
              <s-table-header>Discount</s-table-header>
              <s-table-header format="numeric">Claims</s-table-header>
              <s-table-header>Created</s-table-header>
              <s-table-header>Actions</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {campaigns.map((c) => (
                <s-table-row key={c.id}>
                  <s-table-cell>
                    <s-link href={`/app/campaigns/${c.id}`}>{c.name}</s-link>
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={tone[c.status]}>{c.status.toLowerCase()}</s-badge>
                  </s-table-cell>
                  <s-table-cell>{templateLabel[c.template]}</s-table-cell>
                  <s-table-cell>{c.discount}</s-table-cell>
                  <s-table-cell>{c.claims}</s-table-cell>
                  <s-table-cell>{new Date(c.createdAt).toLocaleDateString()}</s-table-cell>
                  <s-table-cell>
                    <s-button tone="critical" variant="tertiary" onClick={() => askDelete(c)}>
                      Delete
                    </s-button>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <ConfirmModal
        open={target !== null}
        heading={`Delete campaign "${target?.name ?? ""}"?`}
        confirmLabel="Delete campaign"
        destructive
        busy={deleting}
        onClose={() => setTarget(null)}
        onConfirm={() => target && submit({ intent: "delete", id: target.id }, { method: "post" })}
      >
        <s-stack gap="small-200">
          <s-text>This can&apos;t be undone.</s-text>
          {target && target.claims > 0 && (
            <s-banner tone="warning">
              This also deletes its {target.claims} claim{target.claims === 1 ? "" : "s"} from Trekiva. The Shopify
              customers and discount codes stay.
            </s-banner>
          )}
        </s-stack>
      </ConfirmModal>
    </s-page>
  );
}
