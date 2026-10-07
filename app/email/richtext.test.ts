import { describe, expect, it } from "vitest";
import { renderRich, stripRich, type RichContext } from "./richtext";
import { renderEmail, type EmailVars } from "./render";
import { defaultEmail } from "./defaults";
import type { EmailTemplate } from "./schema";

const ctx: RichContext = {
  link: (p) => (p === "{{discount_link}}" ? "https://shop.example/discount/ABC" : "https://shop.example/"),
  fill: (h) => h.replace(/\{\{first_name\}\}/g, "Asha"),
};
const r = (s: string) => renderRich(s, ctx, "m:0;");

describe("rich text", () => {
  it("formats bold, italic and links", () => {
    expect(r("a **bold** and *italic* word")).toBe('<p style="m:0;">a <strong>bold</strong> and <em>italic</em> word</p>');
    expect(r("[Shop](https://shop.example/x)")).toContain('<a href="https://shop.example/x"');
  });

  it("resolves the link placeholders to the customer's real links", () => {
    expect(r("[Use it]({{discount_link}})")).toContain('href="https://shop.example/discount/ABC"');
    expect(r("[Store]({{shop_url}})")).toContain('href="https://shop.example/"');
  });

  it("turns a block of dash lines into a list, and other lines into line breaks", () => {
    expect(r("- one\n- two")).toBe('<ul style="m:0;padding-left:22px;text-align:left;"><li style="margin:0 0 4px;">one</li><li style="margin:0 0 4px;">two</li></ul>');
    // A list written straight under a line of text is still a list.
    expect(r("You get:\n- one\n- two\nBye")).toBe(
      '<p style="m:0;">You get:</p><ul style="m:0;padding-left:22px;text-align:left;"><li style="margin:0 0 4px;">one</li><li style="margin:0 0 4px;">two</li></ul><p style="m:0;">Bye</p>',
    );
    expect(r("one\ntwo")).toBe('<p style="m:0;">one<br>two</p>');
    expect(r("a\n\nb")).toBe('<p style="m:0;">a</p><p style="m:0;">b</p>');
  });

  it("works with placeholders", () => {
    expect(r("Hi **{{first_name}}**")).toContain("<strong>Asha</strong>");
  });

  it("never lets HTML through", () => {
    const out = r('<script>alert(1)</script> <img src=x onerror=alert(1)> **<b>x</b>**');
    expect(out).not.toMatch(/<script|<img|<b>/);
    expect(out).toContain("&lt;script&gt;");
  });

  it("only ever links to https or the two placeholders", () => {
    for (const bad of ["javascript:alert(1)", "http://insecure.example", "data:text/html,x", "//evil.example", "mailto:a@b.co"]) {
      const out = r(`[x](${bad})`);
      expect(out).not.toContain("<a ");
      expect(out).toContain(`[x](${bad})`.replace(/&/g, "&amp;"));
    }
  });

  it("cannot break out of the href attribute", () => {
    const out = r('[x](https://a.example/" onmouseover="alert(1))');
    expect(out).not.toMatch(/<a [^>]*onmouseover/);
    const out2 = r("[x](https://a.example/?q=1&r=2)");
    expect(out2).toContain('href="https://a.example/?q=1&amp;r=2"');
  });

  it("leaves unmatched markers as plain text", () => {
    expect(r("2 * 3 * 4")).toBe('<p style="m:0;">2 * 3 * 4</p>');
    expect(r("**unfinished")).toBe('<p style="m:0;">**unfinished</p>');
  });

  it("writes the plain-text version without markers", () => {
    const link = (p: string) => (p === "{{discount_link}}" ? "https://shop.example/discount/ABC" : "https://shop.example/");
    expect(stripRich("**Hi** *there* [use it]({{discount_link}}) and [site](https://a.example)\n- one\n- two", link)).toBe(
      "Hi there use it (https://shop.example/discount/ABC) and site (https://a.example)\n• one\n• two",
    );
  });
});

describe("rich text inside an email", () => {
  const vars: EmailVars = {
    code: "ABC",
    discountBase: "https://shop.example/discount/ABC",
    shopName: "Shop",
    shopUrl: "https://shop.example/",
    firstName: "Asha",
    unsubscribeUrl: "https://app.example/unsubscribe?t=1",
  };
  const withBody = (body: string) =>
    ({ ...defaultEmail, sections: [{ ...defaultEmail.sections[1], body }, defaultEmail.sections[2]] }) as EmailTemplate;

  it("renders formatting in the html and strips it from the text version", () => {
    const e = renderEmail({ template: withBody("Hello **Asha**, [shop now]({{discount_link}})"), vars });
    expect(e.html).toContain("<strong>Asha</strong>");
    expect(e.html).toContain('href="https://shop.example/discount/ABC"');
    expect(e.text).toContain("Hello Asha, shop now (https://shop.example/discount/ABC)");
    expect(e.text).not.toContain("**");
  });

  it("a customer's name cannot inject formatting or a link", () => {
    const evil = { ...vars, firstName: "[click](https://evil.example) **x**" };
    const e = renderEmail({ template: withBody("Hi {{first_name}}"), vars: evil });
    expect(e.html).not.toContain("evil.example\"");
    expect(e.html).not.toContain("<strong>x</strong>");
    expect(e.html).toContain("[click](https://evil.example) **x**");
  });
});
