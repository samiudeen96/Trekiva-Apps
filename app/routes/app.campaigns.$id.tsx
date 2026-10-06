import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useEffect } from "react";
import { useActionData, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { CampaignForm } from "../components/CampaignForm";
import { listCodeDiscounts } from "../discounts/discounts.server";
import { campaignService, campaignToInput, parseCampaignForm } from "../campaigns/service";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const campaign = await campaignService.get(session.shop, params.id!);
  if (!campaign) throw new Response("Campaign not found", { status: 404 });
  return {
    input: campaignToInput(campaign),
    discounts: await listCodeDiscounts(admin).catch(() => null),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const parsed = parseCampaignForm(await request.formData());
  if (!parsed.ok) return { errors: parsed.errors, saved: false };

  const result = await campaignService.update(session.shop, admin, params.id!, parsed.input);
  if (!result.ok) return { errors: result.errors, saved: false };
  if (!result.value) throw new Response("Campaign not found", { status: 404 });
  return { errors: {}, saved: true };
};

export default function EditCampaign() {
  const { input, discounts } = useLoaderData<typeof loader>();
  const data = useActionData<typeof action>();
  const shopify = useAppBridge();
  useEffect(() => {
    if (data?.saved) shopify.toast.show("Campaign saved");
  }, [data, shopify]);
  return (
    <CampaignForm heading={input.details.name} initial={input}
      errors={data?.errors}
      discounts={discounts}
    />
  );
}
