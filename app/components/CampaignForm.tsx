import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigation, useSubmit } from "react-router";
import type { DiscountSummary } from "../discounts/types";
import type { CampaignInput, CampaignContent } from "../campaigns/schema";
import { parseCampaignForm, type FieldErrors } from "../campaigns/form";
import { CampaignPreview } from "./CampaignPreview";

interface Props {
  initial: CampaignInput;
  errors?: FieldErrors;
  heading: string;
  /** null when Shopify could not be reached */
  discounts: DiscountSummary[] | null;
}

const contentFields: [keyof CampaignContent, string, boolean][] = [
  ["title", "Title", false],
  ["description", "Description", true],
  ["emailPlaceholder", "Email placeholder", false],
  ["buttonText", "Button text", false],
  ["successTitle", "Success title", false],
  ["successMessage", "Success message", true],
  ["alreadyClaimedTitle", "Already claimed title", false],
  ["alreadyClaimedMessage", "Already claimed message", true],
  ["privacyText", "Privacy text", true],
];

/**
 * Reads the Polaris web components directly: React 18 does not wire change events on
 * custom elements, and this avoids depending on form association for submit/preview.
 */
function readForm(form: HTMLFormElement): FormData {
  const fd = new FormData();
  form.querySelectorAll<HTMLElement & { value?: string; checked?: boolean }>("[name]").forEach((el) => {
    const name = el.getAttribute("name")!;
    if (el.tagName === "S-CHECKBOX") {
      if (el.checked) fd.set(name, "on");
    } else {
      fd.set(name, el.value ?? "");
    }
  });
  return fd;
}

export function CampaignForm({ initial, errors = {}, heading, discounts }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const submit = useSubmit();
  const [discountId, setDiscountId] = useState(initial.discountId ?? "");
  const [preview, setPreview] = useState<CampaignInput>(initial);

  const sync = useCallback(() => {
    if (!formRef.current) return;
    const fd = readForm(formRef.current);
    setDiscountId(String(fd.get("discountId") ?? ""));
    const parsed = parseCampaignForm(fd);
    // Mid-edit values can be invalid (e.g. half-typed color): keep the last valid preview.
    if (parsed.ok) setPreview(parsed.input);
  }, []);

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    form.addEventListener("input", sync);
    form.addEventListener("change", sync);
    return () => {
      form.removeEventListener("input", sync);
      form.removeEventListener("change", sync);
    };
  }, [sync]);

  const save = () => {
    if (formRef.current) submit(readForm(formRef.current), { method: "post" });
  };
  const saving = useNavigation().state === "submitting";
  const { details, content, design, rules } = initial;
  const err = (k: string) => errors[k];
  const selected = discounts?.find((d) => d.id === discountId);

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <s-page heading={heading}>
        <s-link slot="breadcrumb-actions" href="/app/campaigns">Campaigns</s-link>
        <s-button slot="primary-action" variant="primary" onClick={save} {...(saving ? { loading: true } : {})}>
          Save
        </s-button>

        {Object.keys(errors).length > 0 && (
          <s-banner tone="critical" heading="Please fix the highlighted fields" />
        )}

        <s-section heading="1. Campaign details">
          <s-stack gap="base">
            <s-text-field name="details.name" label="Campaign name" value={details.name} error={err("details.name")} />
            <s-select name="details.status" label="Status" value={details.status}>
              <s-option value="DRAFT">Draft</s-option>
              <s-option value="ACTIVE">Active</s-option>
              <s-option value="DISABLED">Disabled</s-option>
            </s-select>
          </s-stack>
        </s-section>

        <s-section heading="2. Popup content">
          <s-stack gap="base">
            {contentFields.map(([key, label, multiline]) =>
              multiline ? (
                <s-text-area key={key} name={`content.${key}`} label={label} rows={2} value={content[key]} error={err(`content.${key}`)} />
              ) : (
                <s-text-field key={key} name={`content.${key}`} label={label} value={content[key]} error={err(`content.${key}`)} />
              ),
            )}
          </s-stack>
        </s-section>

        <s-section heading="3. Template">
          <s-select name="details.template" label="Template" value={details.template}>
            <s-option value="SPLIT_IMAGE">Split image + form</s-option>
            <s-option value="CENTERED_MINIMAL">Centered minimal</s-option>
            <s-option value="IMAGE_BANNER">Image banner</s-option>
          </s-select>
        </s-section>

        <s-section heading="4. Design">
          <s-stack gap="base">
            <s-grid gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))" gap="base">
              <s-color-field name="design.backgroundColor" label="Background" value={design.backgroundColor} error={err("design.backgroundColor")} />
              <s-color-field name="design.textColor" label="Text" value={design.textColor} error={err("design.textColor")} />
              <s-color-field name="design.buttonBackground" label="Button background" value={design.buttonBackground} error={err("design.buttonBackground")} />
              <s-color-field name="design.buttonTextColor" label="Button text" value={design.buttonTextColor} error={err("design.buttonTextColor")} />
            </s-grid>
            <s-grid gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))" gap="base">
              <s-number-field name="design.borderRadius" label="Border radius (px)" min={0} max={40} value={String(design.borderRadius)} error={err("design.borderRadius")} />
              <s-number-field name="design.overlayOpacity" label="Overlay opacity (%)" min={0} max={100} value={String(design.overlayOpacity)} error={err("design.overlayOpacity")} />
              <s-number-field name="design.popupWidth" label="Popup width (px)" min={320} max={900} value={String(design.popupWidth)} error={err("design.popupWidth")} />
            </s-grid>
            <s-text-field name="design.imageUrl" label="Image URL (https)" value={design.imageUrl} error={err("design.imageUrl")} />
            <s-select name="design.imagePosition" label="Image position" value={design.imagePosition}>
              <s-option value="left">Left</s-option>
              <s-option value="right">Right</s-option>
              <s-option value="top">Top</s-option>
            </s-select>
            <s-select name="design.alignment" label="Text alignment" value={design.alignment}>
              <s-option value="left">Left</s-option>
              <s-option value="center">Center</s-option>
              <s-option value="right">Right</s-option>
            </s-select>
            <s-checkbox name="design.showCloseIcon" label="Show close icon" checked={design.showCloseIcon} />
          </s-stack>
        </s-section>

        <s-section heading="5. Shopify discount">
          <s-stack gap="base">
            {discounts === null ? (
              <s-banner tone="critical">
                Could not load discounts from Shopify. Reload the page to try again.
              </s-banner>
            ) : (
              <s-select
                name="discountId"
                label="Discount source: Shopify native discount"
                value={discountId}
                error={err("discountId")}
              >
                <s-option value="">Select a discount…</s-option>
                {discounts.map((d) => (
                  <s-option key={d.id} value={d.id}>
                    {d.code} - {d.valueLabel}
                  </s-option>
                ))}
              </s-select>
            )}
            {discounts?.length === 0 && (
              <s-banner tone="info">
                No code discounts found. Create one (for example WELCOME10) in Shopify
                Admin → Discounts, then reload this page.
              </s-banner>
            )}
            {selected && (
              <s-box padding="base" borderWidth="base" borderRadius="base">
                <s-stack gap="small-200">
                  <s-heading>{selected.code}</s-heading>
                  <s-text>{selected.valueLabel}</s-text>
                  <s-text>Status: {selected.status.toLowerCase()}</s-text>
                  <s-text>One use per customer: {selected.oncePerCustomer ? "Yes" : "No"}</s-text>
                  <s-text>Eligibility: {selected.eligibility}</s-text>
                  <s-text>Minimum purchase: {selected.minimumRequirement}</s-text>
                  <s-text>
                    Active: {selected.startsAt ? new Date(selected.startsAt).toLocaleDateString() : "—"}
                    {" → "}
                    {selected.endsAt ? new Date(selected.endsAt).toLocaleDateString() : "no expiry"}
                  </s-text>
                  {selected.warnings.map((w) => (
                    <s-banner key={w} tone="warning">{w}</s-banner>
                  ))}
                </s-stack>
              </s-box>
            )}
            {!selected && discountId && discounts && (
              <s-banner tone="warning">
                The saved discount is no longer available in Shopify.
              </s-banner>
            )}
          </s-stack>
        </s-section>

        <s-section heading="6. Display rules">
          <s-stack gap="base">
            <s-select name="rules.trigger" label="Trigger" value={rules.trigger}>
              <s-option value="delay">After delay</s-option>
              <s-option value="load">On page load</s-option>
              <s-option value="exit_intent">Exit intent (desktop)</s-option>
              <s-option value="manual">Manual trigger</s-option>
            </s-select>
            <s-number-field name="rules.delaySeconds" label="Delay (seconds)" min={0} max={300} value={String(rules.delaySeconds)} error={err("rules.delaySeconds")} />
            <s-select name="rules.pages" label="Pages" value={rules.pages}>
              <s-option value="all">All pages</s-option>
              <s-option value="home">Homepage only</s-option>
              <s-option value="product">Product pages</s-option>
              <s-option value="collection">Collection pages</s-option>
              <s-option value="specific">Specific URLs</s-option>
            </s-select>
            <s-text-area name="rules.specificUrls" label="Specific URL paths (one per line)" rows={3} value={rules.specificUrls.join("\n")} error={err("rules.specificUrls")} />
            <s-select name="rules.devices" label="Devices" value={rules.devices}>
              <s-option value="all">All devices</s-option>
              <s-option value="desktop">Desktop only</s-option>
              <s-option value="mobile">Mobile only</s-option>
            </s-select>
            <s-select name="rules.frequency" label="Display frequency" value={rules.frequency}>
              <s-option value="session">Once per session</s-option>
              <s-option value="visitor">Once per visitor</s-option>
              <s-option value="days">Every X days</s-option>
            </s-select>
            <s-number-field name="rules.frequencyDays" label="Days between displays" min={1} max={365} value={String(rules.frequencyDays)} error={err("rules.frequencyDays")} />
            <s-text color="subdued">
              Frequency only controls when the popup is shown. Each email can still claim a campaign only once.
            </s-text>
          </s-stack>
        </s-section>

        <s-section heading="7. Shopify Flow">
          <s-stack gap="small-200">
            <s-text>
              Trekiva fires the <s-text type="strong">Welcome Offer Claimed</s-text> trigger once per
              first-time claim. Duplicate prevention happens in Trekiva, so your Flow does not need any
              checks for it.
            </s-text>
            <s-text>1. In Shopify Flow, create a workflow and choose the trigger Welcome Offer Claimed.</s-text>
            <s-text>2. Add the action Send marketing email (Shopify Email) to the customer.</s-text>
            <s-text>
              3. In the email, insert the Flow variable for Discount code. Available data: customer, customer
              email, campaign name, discount code, claimed at.
            </s-text>
            <s-text>4. Turn the workflow on.</s-text>
          </s-stack>
        </s-section>
        <s-section heading="8. Preview">
          <CampaignPreview input={preview} />
        </s-section>
        <s-section heading="9. Publish">
          <s-text color="subdued">Set Status to Active and save to publish.</s-text>
        </s-section>
      </s-page>
    </form>
  );
}
