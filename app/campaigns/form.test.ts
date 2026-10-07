import { describe, expect, it } from "vitest";
import { defaultCampaign } from "./defaults";
import { parseCampaignForm } from "./form";
import { newSection } from "../email/defaults";

/** The flat fields the editor submits, with the email template as one JSON field. */
function formData(email: unknown = defaultCampaign.email, overrides: Record<string, string> = {}) {
  const fd = new FormData();
  const d = defaultCampaign;
  fd.set("details.name", d.details.name);
  fd.set("details.status", d.details.status);
  fd.set("details.template", d.details.template);
  for (const [k, v] of Object.entries(d.content)) fd.set(`content.${k}`, String(v));
  for (const [k, v] of Object.entries(d.design)) fd.set(`design.${k}`, String(v));
  if (d.design.showCloseIcon) fd.set("design.showCloseIcon", "on");
  for (const [k, v] of Object.entries(d.rules)) if (k !== "specificUrls" && k !== "firstPurchaseOnly") fd.set(`rules.${k}`, String(v));
  fd.set("rules.specificUrls", "");
  fd.set("email", typeof email === "string" ? email : JSON.stringify(email));
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
}

describe("parseCampaignForm: email template", () => {
  it("accepts the default template", () => {
    const r = parseCampaignForm(formData());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input.email).toEqual(defaultCampaign.email);
  });

  it("keeps a customised template", () => {
    const email = { ...defaultCampaign.email, subject: "Hello {{first_name}}", sections: [...defaultCampaign.email.sections, newSection("button")] };
    const r = parseCampaignForm(formData(email));
    expect(r.ok && r.input.email.subject).toBe("Hello {{first_name}}");
    expect(r.ok && r.input.email.sections).toHaveLength(4);
  });

  it("refuses a template that cannot be read", () => {
    const r = parseCampaignForm(formData("{not json"));
    expect(r).toMatchObject({ ok: false, errors: { email: expect.stringMatching(/could not be read/) } });
    expect(parseCampaignForm(formData("")).ok).toBe(false);
  });

  it("refuses a template without a discount section, naming the problem", () => {
    const r = parseCampaignForm(formData({ ...defaultCampaign.email, sections: [defaultCampaign.email.sections[1]] }));
    expect(r).toMatchObject({ ok: false, errors: { email: expect.stringMatching(/discount section/) } });
  });

  it("refuses an unsafe link", () => {
    const bad = { ...defaultCampaign.email, sections: [...defaultCampaign.email.sections, { ...newSection("button"), url: "javascript:alert(1)" }] };
    expect(parseCampaignForm(formData(bad)).ok).toBe(false);
  });
});
