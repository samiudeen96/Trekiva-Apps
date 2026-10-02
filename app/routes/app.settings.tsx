import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { env } from "../utils/env.server";
import { checkDatabase, checkShopifyAndWebhooks, type Check } from "../utils/health.server";
import { claimRepository } from "../repositories/claim.repository";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const [database, shopifyChecks, stats] = await Promise.all([
    checkDatabase(),
    checkShopifyAndWebhooks(admin, session.scope),
    claimRepository.stats(session.shop),
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
      ["Shopify Flow", flow],
      ["Webhooks", shopifyChecks.webhooks],
    ] as [string, Check][],
  };
};

export default function Settings() {
  const { checks, appUrl, shop, proxyPath } = useLoaderData<typeof loader>();
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
      <s-section heading="Connection details">
        <s-stack gap="small-200">
          <s-text>Shop: {shop}</s-text>
          <s-text>App URL: {appUrl}</s-text>
          <s-text>Storefront proxy: https://{shop}{proxyPath}/*</s-text>
        </s-stack>
      </s-section>
    </s-page>
  );
}
