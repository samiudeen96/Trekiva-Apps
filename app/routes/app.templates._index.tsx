import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData, useNavigation, useSubmit } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { emailTemplateRepository } from "../repositories/email-template.repository";
import { resolveEmailTemplate } from "../email/defaults";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const rows = await emailTemplateRepository.list(session.shop);
  return {
    templates: rows.map((t) => ({
      id: t.id,
      name: t.name,
      subject: resolveEmailTemplate(t.template).subject,
      sections: resolveEmailTemplate(t.template).sections.length,
      campaigns: t.campaigns.map((c) => ({ id: c.id, name: c.name, active: c.status === "ACTIVE" })),
      updatedAt: t.updatedAt.toISOString(),
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const fd = await request.formData();
  const id = String(fd.get("id") ?? "");
  const intent = fd.get("intent");

  if (intent === "duplicate") {
    const t = await emailTemplateRepository.findById(session.shop, id);
    if (!t) return { error: "That template no longer exists.", done: null };
    await emailTemplateRepository.create(session.shop, `${t.name} (copy)`.slice(0, 80), resolveEmailTemplate(t.template));
    return { error: null, done: "Template duplicated" };
  }
  if (intent === "delete") {
    const r = await emailTemplateRepository.remove(session.shop, id);
    if (r.ok) return { error: null, done: "Template deleted" };
    if (r.reason === "IN_USE") {
      return { error: `In use by ${r.campaigns.join(", ")}. Pick another template in those campaigns first.`, done: null };
    }
    return { error: "That template no longer exists.", done: null };
  }
  return { error: null, done: null };
};

export default function Templates() {
  const { templates } = useLoaderData<typeof loader>();
  const data = useActionData<typeof action>();
  const submit = useSubmit();
  const busy = useNavigation().state === "submitting";
  const shopify = useAppBridge();
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    if (data?.done) shopify.toast.show(data.done);
  }, [data, shopify]);

  return (
    <s-page heading="Email templates">
      <s-button slot="primary-action" variant="primary" href="/app/templates/new">
        Create template
      </s-button>

      {data?.error && <s-banner tone="critical">{data.error}</s-banner>}

      <s-section>
        <s-text color="subdued">
          Design your welcome emails here, then pick one in each campaign (step 8). A campaign without a template sends
          the built-in default. Edits apply to every email sent after you save.
        </s-text>
      </s-section>

      <s-section>
        {templates.length === 0 ? (
          <s-stack gap="base" alignItems="center">
            <s-icon type="email" tone="info" />
            <s-text type="strong">No templates yet</s-text>
            <s-text color="subdued">Start from a ready-made design and make it yours.</s-text>
            <s-button variant="primary" href="/app/templates/new">Create template</s-button>
          </s-stack>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Name</s-table-header>
              <s-table-header>Subject</s-table-header>
              <s-table-header>Used by</s-table-header>
              <s-table-header>Updated</s-table-header>
              <s-table-header>Actions</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {templates.map((t) => (
                <s-table-row key={t.id}>
                  <s-table-cell>
                    <s-link href={`/app/templates/${t.id}`}>{t.name}</s-link>
                  </s-table-cell>
                  <s-table-cell>{t.subject}</s-table-cell>
                  <s-table-cell>
                    {t.campaigns.length === 0 ? (
                      <s-text color="subdued">Not used</s-text>
                    ) : (
                      <s-stack direction="inline" gap="small-200">
                        {t.campaigns.map((c) => (
                          <s-badge key={c.id} tone={c.active ? "success" : "neutral"}>
                            {c.name}
                          </s-badge>
                        ))}
                      </s-stack>
                    )}
                  </s-table-cell>
                  <s-table-cell>{new Date(t.updatedAt).toLocaleDateString()}</s-table-cell>
                  <s-table-cell>
                    {confirmId === t.id ? (
                      <s-stack direction="inline" gap="small-200">
                        <s-button
                          tone="critical"
                          variant="primary"
                          onClick={() => {
                            setConfirmId(null);
                            submit({ intent: "delete", id: t.id }, { method: "post" });
                          }}
                          {...(busy ? { loading: true } : {})}
                        >
                          Confirm delete
                        </s-button>
                        <s-button onClick={() => setConfirmId(null)}>Cancel</s-button>
                      </s-stack>
                    ) : (
                      <s-stack direction="inline" gap="small-200">
                        <s-button variant="tertiary" href={`/app/templates/${t.id}`}>Edit</s-button>
                        <s-button variant="tertiary" onClick={() => submit({ intent: "duplicate", id: t.id }, { method: "post" })}>
                          Duplicate
                        </s-button>
                        <s-button
                          variant="tertiary"
                          tone="critical"
                          disabled={t.campaigns.length > 0}
                          onClick={() => setConfirmId(t.id)}
                        >
                          Delete
                        </s-button>
                      </s-stack>
                    )}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}
