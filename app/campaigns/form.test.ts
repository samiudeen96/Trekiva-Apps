import { describe, expect, it } from "vitest";
import { defaultCampaign } from "./defaults";
import { parseCampaignForm } from "./form";

/** The flat fields the editor submits, with the email template as one JSON field. */
function formData(emailTemplateId = "", overrides: Record<string, string> = {}) {
  const fd = new FormData();
  const d = defaultCampaign;
  fd.set("details.name", d.details.name);
  fd.set("details.status", d.details.status);
  fd.set("details.template", d.details.template);
  for (const [k, v] of Object.entries(d.content)) fd.set(`content.${k}`, String(v));
  for (const [k, v] of Object.entries(d.design)) fd.set(`design.${k}`, String(v));
  if (d.design.showCloseIcon) fd.set("design.showCloseIcon", "on");
  for (const [k, v] of Object.entries(d.rules)) {
    if (k === "specificUrls") continue;
    // Checkboxes are sent as "on" when ticked and absent otherwise.
    if (typeof v === "boolean") {
      if (v) fd.set(`rules.${k}`, "on");
    } else fd.set(`rules.${k}`, String(v));
  }
  fd.set("rules.specificUrls", "");
  fd.set("emailTemplateId", emailTemplateId);
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
}

describe("parseCampaignForm: email template", () => {
  it("an empty choice means the built-in default", () => {
    const r = parseCampaignForm(formData(""));
    expect(r.ok && r.input.emailTemplateId).toBeNull();
  });

  it("keeps the picked template id (ownership is checked by the service)", () => {
    const r = parseCampaignForm(formData("cmabc123xyz"));
    expect(r.ok && r.input.emailTemplateId).toBe("cmabc123xyz");
  });

  it("refuses something that is not an id", () => {
    const r = parseCampaignForm(formData("../../etc"));
    expect(r).toMatchObject({ ok: false, errors: { emailTemplateId: expect.any(String) } });
  });

  it("keeps the rest of the campaign valid", () => {
    expect(parseCampaignForm(formData()).ok).toBe(true);
    expect(defaultCampaign.emailTemplateId).toBeNull();
  });
});

describe("parseCampaignForm: how the customer gets the code", () => {
  it("always emails the code and never applies it instantly", () => {
    const r = parseCampaignForm(formData("", { "rules.applyOnSignup": "on", "rules.emailCode": "" }));
    expect(r.ok && r.input.rules).toMatchObject({ applyOnSignup: false, emailCode: true });
  });
});
