import { describe, expect, it } from "vitest";
import { parseTemplateForm } from "./template-form";
import { defaultEmail } from "./defaults";

const fd = (name: string, template: unknown) => {
  const f = new FormData();
  f.set("name", name);
  f.set("template", typeof template === "string" ? template : JSON.stringify(template));
  return f;
};

describe("parseTemplateForm", () => {
  it("accepts a name and a valid template", () => {
    expect(parseTemplateForm(fd("  Welcome  ", defaultEmail))).toEqual({ ok: true, name: "Welcome", template: defaultEmail });
  });

  it("needs a name of sensible length", () => {
    expect(parseTemplateForm(fd(" ", defaultEmail))).toMatchObject({ ok: false, error: expect.stringMatching(/name/) });
    expect(parseTemplateForm(fd("x".repeat(81), defaultEmail)).ok).toBe(false);
  });

  it("explains a broken or invalid template", () => {
    expect(parseTemplateForm(fd("A", "{nope"))).toMatchObject({ ok: false, error: expect.stringMatching(/could not be read/) });
    const noCode = { ...defaultEmail, sections: [defaultEmail.sections[1]] };
    expect(parseTemplateForm(fd("A", noCode))).toMatchObject({ ok: false, error: expect.stringMatching(/discount section/) });
  });
});
