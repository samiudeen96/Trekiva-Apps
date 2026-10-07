import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useActionData, useLoaderData, useNavigation, useSubmit } from "react-router";
import { authenticate } from "../shopify.server";
import { emailTemplateRepository } from "../repositories/email-template.repository";
import { STARTERS } from "../email/defaults";
import { emailConfig, senderName } from "../email/email.server";
import { renderTemplatePreview } from "../components/TemplateEditor";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const mail = emailConfig();
  return { shopName: (mail && senderName(mail.from)) || session.shop };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const fd = await request.formData();
  const starter = STARTERS.find((s) => s.key === fd.get("starter"));
  const name = String(fd.get("name") ?? "").trim().slice(0, 80);
  if (!starter) return { error: "Pick a starting design." };
  if (!name) return { error: "Give the template a name." };
  const t = await emailTemplateRepository.create(session.shop, name, starter.template);
  return redirect(`/app/templates/${t.id}`);
};

export default function NewTemplate() {
  const { shopName } = useLoaderData<typeof loader>();
  const data = useActionData<typeof action>();
  const submit = useSubmit();
  const busy = useNavigation().state !== "idle";
  const [starter, setStarter] = useState(STARTERS[0].key);
  const [name, setName] = useState("Welcome email");

  return (
    <s-page heading="Create email template">
      <s-link slot="breadcrumb-actions" href="/app/templates">Email templates</s-link>
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => submit({ starter, name }, { method: "post" })}
        {...(busy ? { loading: true } : {})}
      >
        Create and edit
      </s-button>

      {data?.error && <s-banner tone="critical">{data.error}</s-banner>}

      <s-section heading="Name">
        <s-text-field label="Template name" value={name} onInput={(e) => setName((e.currentTarget as unknown as { value: string }).value)} />
      </s-section>

      <s-section heading="Start from">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))" gap="base">
          {STARTERS.map((s) => {
            const on = s.key === starter;
            return (
              <button
                key={s.key}
                type="button"
                aria-pressed={on}
                onClick={() => setStarter(s.key)}
                style={{
                  textAlign: "left",
                  padding: 0,
                  borderRadius: 12,
                  overflow: "hidden",
                  cursor: "pointer",
                  background: "#fff",
                  border: on ? "2px solid #2c6ecb" : "1px solid #d4d4d4",
                  font: "inherit",
                  color: "inherit",
                }}
              >
                {/* Scaled-down live render of the starter, sample code included. */}
                <div style={{ height: 260, overflow: "hidden", background: "#f1f1f1", pointerEvents: "none" }}>
                  <iframe
                    title={`${s.name} preview`}
                    sandbox=""
                    tabIndex={-1}
                    srcDoc={renderTemplatePreview(s.template, shopName).html}
                    style={{ width: 640, height: 650, border: 0, transform: "scale(.4)", transformOrigin: "0 0" }}
                  />
                </div>
                <div style={{ padding: "12px 14px" }}>
                  <div style={{ fontWeight: 650 }}>{s.name}</div>
                  <div style={{ fontSize: 13, color: "#616161", marginTop: 2 }}>{s.description}</div>
                </div>
              </button>
            );
          })}
        </s-grid>
      </s-section>
    </s-page>
  );
}
