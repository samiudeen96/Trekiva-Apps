import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useBlocker, useLoaderData, useNavigation, useSubmit } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { z } from "zod";
import { authenticate } from "../shopify.server";
import { emailTemplateRepository } from "../repositories/email-template.repository";
import { resolveEmailTemplate } from "../email/defaults";
import { parseTemplateForm } from "../email/template-form";
import { createEmailGateway, emailConfig, senderName } from "../email/email.server";
import { createStoreUrlResolver } from "../shopify/store-url.server";
import { TemplateEditor } from "../components/TemplateEditor";
import { logger } from "../utils/logger.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const t = await emailTemplateRepository.findById(session.shop, params.id!);
  if (!t) throw new Response("Template not found", { status: 404 });
  const usedBy = await emailTemplateRepository.list(session.shop).then(
    (all) => all.find((x) => x.id === t.id)?.campaigns.map((c) => c.name) ?? [],
  );
  const mail = emailConfig();
  return {
    id: t.id,
    name: t.name,
    template: resolveEmailTemplate(t.template),
    usedBy,
    from: mail?.from ?? null,
    shopName: (mail && senderName(mail.from)) || session.shop,
  };
};

type ActionResult = { saved: boolean; error: string | null; test: { ok: boolean; message: string } | null };

export const action = async ({ request, params }: ActionFunctionArgs): Promise<ActionResult> => {
  const { session, admin } = await authenticate.admin(request);
  const fd = await request.formData();
  const parsed = parseTemplateForm(fd);

  if (fd.get("intent") === "send-test") {
    const fail = (message: string): ActionResult => ({ saved: false, error: null, test: { ok: false, message } });
    const mail = emailConfig();
    const to = z.string().email().safeParse(String(fd.get("to") ?? "").trim());
    if (!mail) return fail("Sending is not set up: set RESEND_API_KEY and EMAIL_FROM (see Settings).");
    if (!to.success) return fail("Enter a valid email address.");
    if (!parsed.ok) return fail(parsed.error);
    try {
      await createEmailGateway(mail, fetch, createStoreUrlResolver(admin)).sendTest({ to: to.data, shopDomain: session.shop, template: parsed.template });
      return { saved: false, error: null, test: { ok: true, message: `Test sent to ${to.data} with a sample code.` } };
    } catch (err) {
      logger.error({ err, shop: session.shop }, "test email failed");
      return fail("Could not send the test. Check the sending domain is verified in Resend.");
    }
  }

  if (!parsed.ok) return { saved: false, error: parsed.error, test: null };
  const ok = await emailTemplateRepository.update(session.shop, params.id!, parsed.name, parsed.template);
  if (!ok) throw new Response("Template not found", { status: 404 });
  return { saved: true, error: null, test: null };
};

export default function EditTemplate() {
  const loaded = useLoaderData<typeof loader>();
  const data = useActionData<typeof action>();
  const nav = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();
  const [name, setName] = useState(loaded.name);
  const [template, setTemplate] = useState(loaded.template);
  const [savedJson, setSavedJson] = useState(() => JSON.stringify([loaded.name, loaded.template]));
  const dirty = JSON.stringify([name, template]) !== savedJson;
  const intent = nav.formData?.get("intent");
  const saving = nav.state !== "idle" && intent === "save";

  // What was last submitted for saving; it becomes the saved baseline once the save succeeds.
  const [pending, setPending] = useState<string | null>(null);
  const [seen, setSeen] = useState(data);
  if (data !== seen) {
    // Adjusting state while rendering (not in an effect) when a new action result arrives.
    setSeen(data);
    if (data?.saved && pending) setSavedJson(pending);
  }
  useEffect(() => {
    if (data?.saved) shopify.toast.show("Template saved");
  }, [data, shopify]);

  // Leaving with unsaved edits asks first.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);

  const post = (extra: Record<string, string>) =>
    submit({ name, template: JSON.stringify(template), ...extra }, { method: "post" });

  return (
    <s-page heading={name || "Email template"} inlineSize="large">
      <s-link slot="breadcrumb-actions" href="/app/templates">Email templates</s-link>
      <s-button
        slot="primary-action"
        variant="primary"
        disabled={!dirty}
        onClick={() => {
          setPending(JSON.stringify([name, template]));
          post({ intent: "save" });
        }} {...(saving ? { loading: true } : {})}>
        Save
      </s-button>

      {blocker.state === "blocked" && (
        <s-banner tone="warning" heading="You have unsaved changes">
          <s-stack direction="inline" gap="small-200">
            <s-button onClick={() => blocker.reset?.()}>Keep editing</s-button>
            <s-button tone="critical" onClick={() => blocker.proceed?.()}>Leave without saving</s-button>
          </s-stack>
        </s-banner>
      )}
      {data?.error && <s-banner tone="critical" heading="Not saved">{data.error}</s-banner>}
      {loaded.usedBy.length > 0 && (
        <s-banner tone="info">
          Used by {loaded.usedBy.join(", ")}. Saving changes the email every later claim in{" "}
          {loaded.usedBy.length === 1 ? "that campaign" : "those campaigns"} receives.
        </s-banner>
      )}

      <TemplateEditor
        name={name}
        onNameChange={setName}
        value={template}
        onChange={setTemplate}
        from={loaded.from}
        shopName={loaded.shopName}
        onSendTest={(to) => post({ intent: "send-test", to })}
        sendingTest={nav.state !== "idle" && intent === "send-test"}
        testResult={data?.test ?? null}
      />
    </s-page>
  );
}
