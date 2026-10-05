import { describe, expect, it } from "vitest";
import { renderWelcomeOffer, senderName, type EmailContent } from "./template";

const content: EmailContent = {
  subject: "Your welcome offer code",
  heading: "Welcome to {{brand}}",
  body: "Thanks for signing up.\n\nUse {{code}} at checkout.",
};
const branding = { brand: "Trekiva", logoUrl: "https://cdn.example.com/banner.jpg" };
const render = (over: Partial<EmailContent> = {}, b = branding, code = "WELCOME10-AB2CD3EF") =>
  renderWelcomeOffer({ content: { ...content, ...over }, discountCode: code, branding: b });

describe("senderName", () => {
  it("reads the display name and tolerates a bare address", () => {
    expect(senderName("Trekiva <offers@trekiva.com>")).toBe("Trekiva");
    expect(senderName('"Trekiva Footwear" <offers@trekiva.com>')).toBe("Trekiva Footwear");
    expect(senderName("offers@trekiva.com")).toBeUndefined();
  });
});

describe("renderWelcomeOffer", () => {
  it("fills {{brand}} and {{code}} in the subject, heading and body", () => {
    const { subject, html, text } = render({ subject: "{{brand}}: {{code}}" });
    expect(subject).toBe("Trekiva: WELCOME10-AB2CD3EF");
    expect(html).toContain("Welcome to Trekiva");
    expect(html).toContain("Use WELCOME10-AB2CD3EF at checkout.");
    expect(text).toContain("Welcome to Trekiva");
    expect(text).toContain("Use WELCOME10-AB2CD3EF at checkout.");
  });

  it("always shows the code box and the single-use note, even if the body omits the code", () => {
    const { html, text } = render({ body: "Thanks!" });
    expect(html).toContain(">WELCOME10-AB2CD3EF</p>");
    expect(html).toContain("can be used once");
    expect(text).toContain("  WELCOME10-AB2CD3EF");
  });

  it("splits blank-line separated paragraphs and keeps single newlines as breaks", () => {
    const { html } = render({ body: "One\nstill one\n\nTwo" });
    expect(html).toContain("One<br>still one</p>");
    expect(html).toContain(">Two</p>");
  });

  it("renders the logo when set and omits it when not", () => {
    expect(render().html).toContain('src="https://cdn.example.com/banner.jpg"');
    expect(render({}, { ...branding, logoUrl: "" }).html).not.toContain("<img");
  });

  it("escapes merchant text so it cannot inject markup", () => {
    const { html } = render({
      heading: "<script>alert(1)</script> & co",
      body: '<img src=x onerror="alert(1)">',
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; co");
  });

  it("escapes a hostile brand and a hostile code", () => {
    const { html } = render({}, { ...branding, brand: "<b>x</b>" }, "<i>c</i>");
    expect(html).not.toContain("<b>x</b>");
    expect(html).not.toContain("<i>c</i>");
  });

  it("does not expand placeholders that appear inside an inserted value", () => {
    const { html } = render({ body: "{{brand}}" }, { ...branding, brand: "{{code}}" });
    expect(html).toContain(">{{code}}</p>");
  });

  it("keeps the subject on one line", () => {
    expect(render({ subject: "Hi\r\nBcc: x@y.z" }).subject).toBe("Hi Bcc: x@y.z");
  });
});
