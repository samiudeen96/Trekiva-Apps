import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData, useNavigation, useSubmit } from "react-router";
import { authenticate } from "../shopify.server";
import { env } from "../utils/env.server";
import {
  checkCampaignDiscounts,
  checkDatabase,
  checkShopify,
  type Check,
} from "../utils/health.server";
import { claimRepository } from "../repositories/claim.repository";
import { campaignRepository } from "../repositories/campaign.repository";
import { getCodeDiscount } from "../discounts/discounts.server";
import { ClaimService } from "../claims/claim.service";
import { retryClaims } from "../claims/retry";
import { createCustomerGateway } from "../shopify/customers.server";
import { createFlowGateway } from "../flow/flow.server";
import { createDiscountCodeGateway } from "../discounts/redeem-codes.server";

const RETRY_BATCH = 50;
const FAILURES_SHOWN = 5;

const stepLabel: Record<string, string> = {
  customer: "Creating the Shopify customer",
  discount: "Adding the discount code",
  flow: "Triggering Shopify Flow",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const campaigns = (await campaignRepository.listWithClaimCounts(session.shop)).filter(
    (c) => c.status === "ACTIVE",
  );
  const [database, shopifyChecks, stats, discounts, failed] = await Promise.all([
    checkDatabase(),
    checkShopify(admin, session.scope),
    claimRepository.stats(session.shop),
    checkCampaignDiscounts(campaigns, (id) => getCodeDiscount(admin, id)),
    claimRepository.failed(session.shop, FAILURES_SHOWN),
  ]);

  // Shopify offers no API to confirm a Flow workflow is switched on, so report evidence instead.
  const flow: Check = stats.failed > 0
    ? { ok: false, detail: `${stats.failed} claim(s) failed before Flow was triggered` }
    : stats.lastFlowTriggeredAt
      ? { ok: true, detail: `Last trigger fired ${stats.lastFlowTriggeredAt.toISOString()}` }
      : { ok: true, detail: "No trigger fired yet. Create the Flow workflow, then submit a test email." };

  return {
    shop: session.shop,
    appUrl: env.SHOPIFY_APP_URL,
    proxyPath: "/apps/trekiva",
    checks: [
      ["Shopify connection", shopifyChecks.shopify],
      ["Granted scopes", shopifyChecks.scopes],
      ["Database", database],
      ["Campaign discounts", discounts],
      ["Shopify Flow", flow],
    ] as [string, Check][],
    failedTotal: stats.failed,
    failures: failed.map((c) => ({
      id: c.id,
      email: c.emailNormalized,
      campaign: c.campaign.name,
      step: c.failureStep ? (stepLabel[c.failureStep] ?? c.failureStep) : null,
      reason: c.failureReason,
      at: c.updatedAt.toISOString(),
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  if ((await request.formData()).get("intent") !== "retry-failed") return { retry: null };

  const rows = await claimRepository.failed(session.shop, RETRY_BATCH);
  const service = new ClaimService(
    createCustomerGateway(admin),
    createFlowGateway(admin),
    createDiscountCodeGateway(admin),
  );
  const retry = await retryClaims(rows, ({ campaignId, email }) =>
    service.claim({ shopDomain: session.shop, campaignId, email }),
  );
  return { retry };
};

export default function Settings() {
  const { checks, appUrl, shop, proxyPath, failures, failedTotal } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>()?.retry;
  const submit = useSubmit();
  const retrying = useNavigation().state === "submitting";

  return (
    <s-page heading="Settings">
      <s-section heading="Status">
        <s-stack gap="base">
          {checks.map(([label, c]) => (
            <s-stack key={label} direction="inline" gap="base" alignItems="center">
              <s-badge tone={c.ok ? "success" : "critical"}>{c.ok ? "OK" : "Attention"}</s-badge>
              <s-stack gap="small-500">
                <s-text type="strong">{label}</s-text>
                <s-text color="subdued">{c.detail}</s-text>
              </s-stack>
            </s-stack>
          ))}
        </s-stack>
      </s-section>

      {failedTotal > 0 && (
        <s-section heading="Failed claims">
          <s-stack gap="base">
            {result && (
              <s-banner tone={result.failed > 0 ? "warning" : "success"}>
                Retried {result.attempted}: {result.succeeded} succeeded, {result.failed} failed again
                {result.skipped > 0 ? `, ${result.skipped} skipped` : ""}.
              </s-banner>
            )}
            <s-text color="subdued">
              These customers claimed an offer but did not get their email. Fix the cause below, then retry.
              {failedTotal > failures.length ? ` Showing the latest ${failures.length} of ${failedTotal}.` : ""}
            </s-text>
            {failures.map((f) => (
              <s-box key={f.id} padding="base" borderWidth="base" borderRadius="base">
                <s-stack gap="small-500">
                  <s-text type="strong">{f.email}</s-text>
                  <s-text color="subdued">
                    {f.campaign} · {new Date(f.at).toLocaleString()}
                  </s-text>
                  <s-text>
                    {f.step ? `Stopped at: ${f.step}` : "Reason not recorded (failed before this was tracked)"}
                  </s-text>
                  {f.reason && <s-text color="subdued">{f.reason}</s-text>}
                </s-stack>
              </s-box>
            ))}
            <s-stack direction="inline">
              <s-button
                variant="primary"
                onClick={() => submit({ intent: "retry-failed" }, { method: "post" })}
                {...(retrying ? { loading: true } : {})}
              >
                Retry failed claims
              </s-button>
            </s-stack>
          </s-stack>
        </s-section>
      )}

      <s-section heading="Connection details">
        <s-stack gap="small-200">
          <s-text>Shop: {shop}</s-text>
          <s-text>App URL: {appUrl}</s-text>
          <s-text>{`Storefront proxy: https://${shop}${proxyPath}/*`}</s-text>
        </s-stack>
      </s-section>
    </s-page>
  );
}
