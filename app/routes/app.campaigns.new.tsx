import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useActionData, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { CampaignForm } from "../components/CampaignForm";
import { defaultCampaign } from "../campaigns/defaults";
import { listCodeDiscounts } from "../discounts/discounts.server";
import { campaignService, parseCampaignForm } from "../campaigns/service";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  return { discounts: await listCodeDiscounts(admin).catch(() => null) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const parsed = parseCampaignForm(await request.formData());
  if (!parsed.ok) return { errors: parsed.errors };

  const result = await campaignService.create(session.shop, admin, parsed.input);
  if (!result.ok) return { errors: result.errors };
  return redirect(`/app/campaigns/${result.value.id}`);
};

export default function NewCampaign() {
  const data = useActionData<typeof action>();
  const { discounts } = useLoaderData<typeof loader>();
  return (
    <CampaignForm
      heading="Create campaign"
      initial={defaultCampaign}
      errors={data?.errors}
      discounts={discounts}
    />
  );
}
