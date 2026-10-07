import { describe, expect, it } from "vitest";
import { defaultEmail, newSection, resolveEmailTemplate } from "./defaults";
import { renderEmail, type EmailVars } from "./render";
import { emailTemplateSchema, type EmailTemplate } from "./schema";

const vars: EmailVars = {
  code: "WELCOME10-7KQ2M9XH",
  discountBase: "https://shop.myshopify.com/discount/WELCOME10-7KQ2M9XH",
  shopName: "Trekiva",
  shopUrl: "https://shop.myshopify.com/",
  firstName: "Asha",
  unsubscribeUrl: "https://app.example.com/unsubscribe?t=abc",
};

const tpl = (patch: Partial<EmailTemplate> = {}): EmailTemplate => ({ ...defaultEmail, ...patch });

describe("renderEmail: content", () => {
  it("shows the customer's own code, a link that applies it, and fills the placeholders", () => {
    const r = renderEmail({ template: defaultEmail, vars });
    expect(r.html).toContain("WELCOME10-7KQ2M9XH");
    expect(r.html).toContain('href="https://shop.myshopify.com/discount/WELCOME10-7KQ2M9XH"');
    expect(r.html).toContain("Hi Asha,");
    expect(r.html).toContain("Welcome to Trekiva");
    expect(r.subject).toBe("Your welcome offer from Trekiva");
    expect(r.previewText).toBe("Your personal discount code is inside");
    expect(r.text).toContain("WELCOME10-7KQ2M9XH");
    expect(r.text).toContain("https://shop.myshopify.com/discount/WELCOME10-7KQ2M9XH");
  });

  it('greets "there" when there is no first name', () => {
    expect(renderEmail({ template: defaultEmail, vars: { ...vars, firstName: null } }).html).toContain("Hi there,");
    expect(renderEmail({ template: defaultEmail, vars: { ...vars, firstName: "  " } }).html).toContain("Hi there,");
  });

  it("encodes the redirect path into the discount link", () => {
    const t = tpl({
      sections: [{ ...newSection("discount"), redirectPath: "/collections/sandals?x=1&y=2" } as EmailTemplate["sections"][number]],
    });
    expect(renderEmail({ template: t, vars }).html).toContain(
      `${vars.discountBase}?redirect=%2Fcollections%2Fsandals%3Fx%3D1%26y%3D2`,
    );
  });

  it("always includes the code, even for a stored template that lost its discount section", () => {
    const stripped = { ...defaultEmail, sections: [defaultEmail.sections[1]] };
    expect(renderEmail({ template: stripped, vars }).html).toContain("WELCOME10-7KQ2M9XH");
  });

  it("is email-safe: table layout, a mobile stacking rule and a hidden preheader", () => {
    const t = tpl({ sections: [...defaultEmail.sections, newSection("columns"), newSection("imageText")] });
    const { html } = renderEmail({ template: t, vars });
    expect(html).toMatch(/<table role="presentation"/);
    expect(html).toContain("@media only screen and (max-width:620px)");
    expect(html).toContain("display:none;max-height:0");
    expect(html).not.toMatch(/<script|<iframe|onerror=|javascript:/i);
  });
});

describe("renderEmail: safety", () => {
  const evil = '<img src=x onerror=alert(1)>"\'&';

  it("escapes everything a merchant or a customer can type", () => {
    const t = tpl({
      subject: "Hi {{first_name}} <b>",
      sections: [
        { ...newSection("text"), heading: evil, body: evil } as EmailTemplate["sections"][number],
        { ...newSection("discount"), heading: evil, description: evil, note: evil } as EmailTemplate["sections"][number],
      ],
      footer: { address: evil },
    });
    const r = renderEmail({ template: t, vars: { ...vars, firstName: evil, shopName: evil } });
    expect(r.html).not.toContain("<img src=x");
    expect(r.html).not.toMatch(/<[^>]*onerror=/i);
    expect(r.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("never lets a value re-expand a placeholder", () => {
    const r = renderEmail({ template: defaultEmail, vars: { ...vars, firstName: "{{code}}" } });
    expect(r.html).toContain("Hi {{code}},");
  });

  it("drops a link that is not https or a known placeholder", () => {
    // The schema rejects these on save; the renderer is the second line of defence for stored data.
    const t = tpl({
      sections: [
        ...defaultEmail.sections,
        { ...newSection("button"), url: "javascript:alert(1)", label: "Bad" } as EmailTemplate["sections"][number],
        { ...newSection("button"), url: "http://insecure.example.com", label: "Insecure" } as EmailTemplate["sections"][number],
      ],
    });
    const { html } = renderEmail({ template: t, vars });
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("insecure.example.com");
    expect(html).not.toContain(">Bad<");
  });
});

describe("renderEmail: footer and consent", () => {
  it("always ends a full email with the unsubscribe link", () => {
    const { html, text } = renderEmail({ template: defaultEmail, vars });
    expect(html).toContain('href="https://app.example.com/unsubscribe?t=abc"');
    expect(html.lastIndexOf("Unsubscribe")).toBeGreaterThan(html.indexOf("WELCOME10-7KQ2M9XH"));
    expect(text).toContain("Unsubscribe: https://app.example.com/unsubscribe?t=abc");
  });

  it("gives someone who is not subscribed only their code: no marketing, no unsubscribe", () => {
    const t = tpl({
      sections: [...defaultEmail.sections, newSection("columns"), newSection("button")],
    });
    const { html, text, previewText } = renderEmail({ template: t, vars: { ...vars, unsubscribeUrl: null }, mode: "codeOnly" });
    expect(html).toContain("WELCOME10-7KQ2M9XH");
    expect(html).not.toContain("Welcome to Trekiva"); // the text section
    expect(html).not.toContain("Free shipping"); // the columns section
    expect(html).not.toContain("unsubscribe");
    expect(html).toContain("not subscribed to marketing email");
    expect(text).toContain("not subscribed to marketing email");
    expect(previewText).toBe("Your welcome discount code");
  });
});

describe("template validation", () => {
  const parse = (t: unknown) => emailTemplateSchema.safeParse(t);

  it("accepts the default template and a rich one", () => {
    expect(parse(defaultEmail).success).toBe(true);
    const rich = tpl({
      sections: [
        ...defaultEmail.sections,
        newSection("image"),
        newSection("imageText"),
        newSection("button"),
        newSection("columns"),
      ],
    });
    expect(parse(rich).success).toBe(true);
  });

  it("requires a discount section so the code is always in the email", () => {
    expect(parse(tpl({ sections: [defaultEmail.sections[1]] })).success).toBe(false);
  });

  it("rejects unsafe urls and paths", () => {
    const withSection = (s: object) => parse(tpl({ sections: [...defaultEmail.sections, s as EmailTemplate["sections"][number]] }));
    expect(withSection({ ...newSection("button"), url: "javascript:alert(1)" }).success).toBe(false);
    expect(withSection({ ...newSection("button"), url: "http://x.co" }).success).toBe(false);
    expect(withSection({ ...newSection("button"), url: "{{discount_link}}" }).success).toBe(true);
    expect(withSection({ ...newSection("image"), imageUrl: "data:image/png;base64,AAAA" }).success).toBe(false);
    expect(withSection({ ...newSection("discount"), redirectPath: "//evil.example.com" }).success).toBe(false);
    expect(withSection({ ...newSection("discount"), redirectPath: "/collections/sandals" }).success).toBe(true);
  });

  it("bounds the size of the template", () => {
    const many = Array.from({ length: 21 }, () => newSection("button"));
    expect(parse(tpl({ sections: [...defaultEmail.sections, ...many] })).success).toBe(false);
    expect(parse(tpl({ subject: "" })).success).toBe(false);
  });
});

describe("resolveEmailTemplate", () => {
  it("gives a campaign saved before templates existed the default", () => {
    expect(resolveEmailTemplate({})).toEqual(defaultEmail);
    expect(resolveEmailTemplate(null)).toEqual(defaultEmail);
    expect(resolveEmailTemplate(undefined)).toEqual(defaultEmail);
  });

  it("uses a valid stored template and falls back rather than send a broken one", () => {
    const stored = { ...defaultEmail, subject: "Custom {{shop_name}}" };
    expect(resolveEmailTemplate(stored).subject).toBe("Custom {{shop_name}}");
    expect(resolveEmailTemplate({ subject: "x", sections: "nope" })).toEqual(defaultEmail);
  });
});

describe("renderEmail: editor preview mode", () => {
  const t = tpl({ sections: [...defaultEmail.sections, newSection("image")] });

  it("tags every section so a click selects it, and marks the selected one", () => {
    const { html } = renderEmail({ template: t, vars, preview: { selectedId: "intro" } });
    for (const s of t.sections) expect(html).toContain(`data-section="${s.id}"`);
    expect(html).toMatch(/<tr data-section="intro" data-selected/);
    expect(html.match(/<tr[^>]*data-selected/g)).toHaveLength(1);
  });

  it("shows a clickable placeholder for a section that would render nothing yet", () => {
    const { html } = renderEmail({ template: t, vars, preview: { selectedId: null } });
    expect(html).toContain("Image: add an image URL");
  });

  it("restores the scroll position and posts clicks to the editor", () => {
    const { html } = renderEmail({ template: t, vars, preview: { selectedId: null, scrollY: 340 } });
    expect(html).toContain("window.scrollTo(0,340)");
    expect(html).toContain("trekivaSection");
  });

  it("never puts editor markup or script into a real email", () => {
    const { html } = renderEmail({ template: t, vars });
    expect(html).not.toMatch(/<script|data-section|data-selected|Image: add an image URL/);
  });

  it("escapes a hostile section id even in the preview", () => {
    const evil = tpl({ sections: [{ ...defaultEmail.sections[2], id: 'x"><script>alert(1)</script>' } as EmailTemplate["sections"][number]] });
    const { html } = renderEmail({ template: evil, vars, preview: { selectedId: null } });
    expect(html).not.toContain("<script>alert(1)");
  });
});

describe("starter templates", () => {
  it("are all valid and each shows the customer's code", async () => {
    const { STARTERS } = await import("./defaults");
    expect(STARTERS.length).toBeGreaterThanOrEqual(3);
    for (const s of STARTERS) {
      expect(emailTemplateSchema.safeParse(s.template).success).toBe(true);
      expect(renderEmail({ template: s.template, vars }).html).toContain(vars.code);
    }
    expect(new Set(STARTERS.map((s) => s.key)).size).toBe(STARTERS.length);
  });
});
