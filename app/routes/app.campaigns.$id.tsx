import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useEffect } from "react";
import { useActionData, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { CampaignForm } from "../components/CampaignForm";
import { listCodeDiscounts } from "../discounts/discounts.server";
import { campaignService, campaignToInput, parseCampaignForm } from "../campaigns/service";
import { createEmailGateway, emailConfig, senderName } from "../email/email.server";
import { emailTemplateSchema } from "../email/schema";
import { logger } from "../utils/logger.server";
import { z } from "zod";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const campaign = await campaignService.get(session.shop, params.id!);
  if (!campaign) throw new Response("Campaign not found", { status: 404 });
  const mail = emailConfig();
  return {
    input: campaignToInput(campaign),
    discounts: await listCodeDiscounts(admin).catch(() => null),
    emailEnabled: Boolean(mail),
    shopName: (mail && senderName(mail.from)) || session.shop,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const form = await request.formData();

  if (form.get("intent") === "send-test") {
    const mail = emailConfig();
    const to = z.string().email().safeParse(String(form.get("to") ?? "").trim());
    const template = (() => {
      try {
        return emailTemplateSchema.safeParse(JSON.parse(String(form.get("email") ?? "")));
      } catch {
        return null;
      }
    })();
    const fail = (message: string) => ({ errors: {}, saved: false, test: { ok: false, message } });
    if (!mail) return fail("Sending is not configured: set RESEND_API_KEY and EMAIL_FROM.");
    if (!to.success) return fail("Enter a valid email address.");
    if (!template?.success) return fail("The template has an error. Fix it and try again.");
    try {
      await createEmailGateway(mail).sendTest({ to: to.data, shopDomain: session.shop, template: template.data });
      return { errors: {}, saved: false, test: { ok: true, message: `Test email sent to ${to.data}.` } };
    } catch (err) {
      logger.error({ err, shop: session.shop }, "test email failed");
      return fail("Could not send the test email. Check the sender domain is verified in Resend.");
    }
  }

  const parsed = parseCampaignForm(form);
  if (!parsed.ok) return { errors: parsed.errors, saved: false };

  const result = await campaignService.update(session.shop, admin, params.id!, parsed.input);
  if (!result.ok) return { errors: result.errors, saved: false };
  if (!result.value) throw new Response("Campaign not found", { status: 404 });
  return { errors: {}, saved: true };
};

export default function EditCampaign() {
  const { input, discounts, emailEnabled, shopName } = useLoaderData<typeof loader>();
  const data = useActionData<typeof action>();
  const shopify = useAppBridge();
  useEffect(() => {
    if (data?.saved) shopify.toast.show("Campaign saved");
  }, [data, shopify]);
  return (
    <CampaignForm heading={input.details.name} initial={input}
      errors={data?.errors}
      discounts={discounts}
      emailEnabled={emailEnabled}
      shopName={shopName}
      testResult={data && "test" in data ? data.test : null}
    />
  );
}
