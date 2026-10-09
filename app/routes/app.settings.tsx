import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData, useNavigation, useSubmit } from "react-router";
import { authenticate } from "../shopify.server";
import { env } from "../utils/env.server";
import {
  checkCampaignDiscounts,
  checkDatabase,
  checkMetafieldDefinitions,
  checkShopify,
  checkWriteAccess,
  missingScopes,
  type Check,
} from "../utils/health.server";
import { TAG_CLAIMED, TAG_EMAIL_SENT } from "../claims/handoff";
import { ensureMetafieldDefinitions } from "../shopify/handoff.server";
import { createEmailGateway, emailConfig } from "../email/email.server";
import { createStoreUrlResolver } from "../shopify/store-url.server";
import { createProductResolver } from "../shopify/products.server";
import { claimRepository } from "../repositories/claim.repository";
import { campaignRepository } from "../repositories/campaign.repository";
import { getCodeDiscount } from "../discounts/discounts.server";
import { ClaimService } from "../claims/claim.service";
import { retryClaims } from "../claims/retry";
import { createCustomerGateway } from "../shopify/customers.server";
import { createDiscountCodeGateway } from "../discounts/redeem-codes.server";

const RETRY_BATCH = 50;
const FAILURES_SHOWN = 5;

const stepLabel: Record<string, string> = {
  customer: "Creating the Shopify customer",
  discount: "Adding the discount code",
  metafields: "Writing the customer metafields",
  tag: "Adding the Flow trigger tag",
  email: "Sending the welcome email",
  flow: "Triggering Shopify Flow (legacy)",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const campaigns = (await campaignRepository.listWithClaimCounts(session.shop)).filter(
    (c) => c.status === "ACTIVE",
  );
  const [database, shopifyChecks, stats, discounts, failed, definitions] = await Promise.all([
    checkDatabase(),
    checkShopify(admin, session.scope),
    claimRepository.stats(session.shop),
    checkCampaignDiscounts(campaigns, (id) => getCodeDiscount(admin, id)),
    claimRepository.failed(session.shop, FAILURES_SHOWN),
    checkMetafieldDefinitions(admin),
  ]);
  const access = checkWriteAccess(session.scope);
  const mail = emailConfig();
  // With Resend configured the app sends the email itself, so Flow and its metafields are optional.
  const emailSending: Check = mail
    ? {
        ok: true,
        detail: `The app sends the welcome email from ${mail.from}. Turn off any Shopify Flow email workflow so customers are not emailed twice, and make sure the sending domain is verified in Resend.`,
      }
    : {
        ok: false,
        detail: "Not configured: Shopify Flow sends the email. Set RESEND_API_KEY and EMAIL_FROM to send from the app with your own template.",
      };
  const activeCampaign: Check =
    campaigns.length > 0
      ? { ok: true, detail: `${campaigns.length} active campaign(s)` }
      : { ok: false, detail: "No active campaign: the popup is not showing on your store" };

  // Shopify offers no API to confirm a Flow workflow exists or is switched on, so this reports
  // whether the app side is ready and what has been handed over so far.
  const appReady = [shopifyChecks.shopify, shopifyChecks.scopes, access.customers, access.discounts, database, definitions].every(
    (c) => c.ok,
  );
  const flow: Check = mail
    ? { ok: true, detail: "Not used: the app sends the email, so no Flow workflow is needed." }
    : !appReady
    ? { ok: false, detail: "Not ready: fix the checks above first" }
    : stats.failed > 0
      ? { ok: false, detail: `${stats.failed} claim(s) failed before the Flow handoff` }
      : stats.lastHandoffAt
        ? { ok: true, detail: `Ready for Shopify Flow. Last claim handed over ${stats.lastHandoffAt.toISOString()}` }
        : { ok: true, detail: "Ready for Shopify Flow. Create the workflow below, then submit a test email." };

  return {
    shop: session.shop,
    appUrl: env.SHOPIFY_APP_URL,
    proxyPath: "/apps/trekiva",
    checks: [
      ["Shopify connection", shopifyChecks.shopify],
      ["Granted scopes", shopifyChecks.scopes],
      [
        mail ? "Customer write access" : "Customer, metafield and tag write access",
        mail ? { ...access.customers, detail: access.customers.ok ? "write_customers granted: Trekiva can find or create the customer who claims" : access.customers.detail } : access.customers,
      ],
      ["Discount write access", access.discounts],
      [
        "Product access (for the email's product section)",
        missingScopes(["read_products"], session.scope).length
          ? { ok: false, detail: "read_products is missing, so product sections are left out of emails. Add it to SCOPES, run shopify app deploy and approve the new permission." }
          : { ok: true, detail: "read_products granted: the email can show your products" },
      ],
      ["Database", database],
      ["Active campaign", activeCampaign],
      ["Linked Shopify discount", discounts],
      ["Welcome email sending", emailSending],
      // Flow's metafields and integration only matter when Flow (not the app) sends the email.
      ...(mail
        ? []
        : [
            ["Customer metafield definitions", definitions],
            ["Shopify Flow integration", flow],
          ]),
    ] as [string, Check][],
    definitionsMissing: !mail && definitions.missing.length > 0,
    appSendsEmail: Boolean(mail),
    triggerTag: TAG_CLAIMED,
    sentTag: TAG_EMAIL_SENT,
    failedTotal: stats.failed,
    failures: failed.map((c) => ({
      id: c.id,
      email: c.emailNormalized,
      campaign: c.campaign.name,
      step: c.failureStep ? (stepLabel[c.failureStep] ?? c.failureStep) : null,
      reason: c.failureReason,
      instant: c.delivery === "INSTANT",
      at: c.updatedAt.toISOString(),
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const intent = (await request.formData()).get("intent");

  if (intent === "create-definitions") {
    try {
      return { retry: null, definitions: await ensureMetafieldDefinitions(admin) };
    } catch {
      return { retry: null, definitions: { created: [], failed: [{ key: "all", message: "Shopify request failed" }] } };
    }
  }
  if (intent !== "retry-failed") return { retry: null, definitions: null };

  const rows = await claimRepository.failed(session.shop, RETRY_BATCH);
  const mail = emailConfig();
  const service = new ClaimService(
    createCustomerGateway(admin),
    createDiscountCodeGateway(admin),
    mail ? createEmailGateway(mail, fetch, createStoreUrlResolver(admin), createProductResolver(admin)) : undefined,
  );
  const retry = await retryClaims(rows, ({ campaignId, email }) =>
    service.claim({ shopDomain: session.shop, campaignId, email }),
  );
  return { retry, definitions: null };
};

export default function Settings() {
  const { checks, appUrl, shop, proxyPath, failures, failedTotal, definitionsMissing, appSendsEmail, triggerTag, sentTag } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const result = actionData?.retry;
  const defResult = actionData?.definitions;
  const submit = useSubmit();
  const retrying = useNavigation().state === "submitting";

  return (
    <s-page heading="Status">
      <s-section heading="Checks">
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

      {!appSendsEmail && (
      <s-section heading="Shopify Flow setup">
        <s-stack gap="small-200">
          <s-text>
            Trekiva does not send the email. After a claim it saves the customer&apos;s code in metafields and
            adds the tag <s-text type="strong">{triggerTag}</s-text>; your Flow workflow does the rest.
          </s-text>
          <s-text>1. Trigger: Customer tags added.</s-text>
          <s-text>2. Condition: Tags contains {triggerTag}.</s-text>
          <s-text>3. Action: Send marketing email to the customer. The code is in the customer metafield trekiva.welcome_discount_code.</s-text>
          <s-text>4. Action: Add customer tags {sentTag}.</s-text>
          <s-text color="subdued">
            Flow adds {sentTag}, not Trekiva. Trekiva reads it only to show &quot;Email sent&quot;. No custom Flow
            trigger or Shopify Plus is needed. Shopify Email only reaches customers subscribed to email marketing.
          </s-text>
          {defResult && (
            <s-banner tone={defResult.failed.length ? "warning" : "success"}>
              {defResult.created.length > 0 && `Created: ${defResult.created.join(", ")}. `}
              {defResult.failed.map((f) => `${f.key}: ${f.message}`).join(" ")}
              {defResult.created.length === 0 && defResult.failed.length === 0 && "Nothing to create."}
            </s-banner>
          )}
          {definitionsMissing && (
            <s-stack direction="inline">
              <s-button onClick={() => submit({ intent: "create-definitions" }, { method: "post" })}>
                Create metafield definitions
              </s-button>
            </s-stack>
          )}
        </s-stack>
      </s-section>
      )}

      {failedTotal > 0 && (
        <s-section heading="Failed claims">
          <s-stack gap="base">
            {result && (
              <s-banner tone={result.failed > 0 ? "warning" : "success"}>
                Retried {result.attempted}: {result.succeeded} succeeded, {result.failed} failed again
                {result.skipped > 0 ? `, ${result.skipped} skipped` : ""}.
                {result.needsCustomer > 0 &&
                  ` ${result.needsCustomer} instant-apply claim(s) were left alone: they complete when that customer submits the popup again.`}
              </s-banner>
            )}
            <s-text color="subdued">
              These customers claimed an offer but their email was not sent. Fix the cause below, then retry.
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
                  {f.instant && (
                    <s-text color="subdued">
                      Instant apply with no email: a retry from here cannot reach this customer. It completes when they
                      submit the popup again.
                    </s-text>
                  )}
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
