// Pure (no server imports): shared by the email gateway and the editor's live preview.

/** The merchant-editable parts of the welcome email. The code box and footer are fixed. */
export interface EmailContent {
  subject: string;
  heading: string;
  body: string;
}

export interface EmailBranding {
  /** Shown wherever the text uses {{brand}}. */
  brand: string;
  /** https image shown at the top of the email, or "" for none. */
  logoUrl: string;
}

export const EMAIL_PLACEHOLDERS = ["{{code}}", "{{brand}}"] as const;

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

/**
 * Display name out of an RFC 5322 sender ("Trekiva <offers@trekiva.com>" -> "Trekiva").
 * A bare address has no name to show.
 */
export function senderName(from: string): string | undefined {
  const name = from.match(/^\s*"?([^"<]*?)"?\s*</)?.[1]?.trim();
  return name || undefined;
}

/** Replaces {{code}} and {{brand}} in one pass, so a value can never be re-expanded. */
function fill(text: string, values: { code: string; brand: string }): string {
  return text.replace(/\{\{\s*(code|brand)\s*\}\}/gi, (_, key: string) =>
    key.toLowerCase() === "code" ? values.code : values.brand,
  );
}

/** Blank-line separated paragraphs; single newlines inside one stay as line breaks. */
function paragraphs(html: string): string {
  return html
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1a1a1a;">${p.replace(/\n/g, "<br>")}</p>`,
    )
    .join("\n        ");
}

/**
 * The customer-facing welcome email. The merchant's text is escaped before it is placed in
 * the markup, so nothing they type can break the layout or inject HTML. The code box and the
 * single-use footer are not editable: a campaign can never send an email without its code.
 */
export function renderWelcomeOffer(input: {
  content: EmailContent;
  discountCode: string;
  branding: EmailBranding;
}) {
  const { content, branding } = input;
  const brand = branding.brand;
  const code = input.discountCode;

  const subject = fill(content.subject, { code, brand }).replace(/\s+/g, " ").trim();
  const heading = fill(content.heading, { code, brand }).trim();
  const body = fill(content.body, { code, brand }).trim();

  const h = (s: string) => escapeHtml(s);
  const filledHtml = (s: string) =>
    fill(h(s), { code: h(code), brand: h(brand) }).trim();

  const logo = branding.logoUrl
    ? `<tr><td style="padding:0;line-height:0;"><img src="${h(branding.logoUrl)}" alt="${h(brand)}" width="560" style="display:block;width:100%;max-width:560px;height:auto;border:0;"></td></tr>`
    : "";

  const html = `<!doctype html>
<html>
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${h(subject)}</title></head>
  <body style="margin:0;padding:24px 12px;background:#000000;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;">
      ${logo}
      <tr><td style="padding:32px;">
        <h1 style="margin:0 0 16px;font-size:24px;line-height:1.3;color:#000000;">${filledHtml(content.heading)}</h1>
        ${paragraphs(filledHtml(content.body))}
        <p style="margin:8px 0 24px;padding:20px;text-align:center;background:#000000;color:#ffffff;font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:22px;font-weight:700;letter-spacing:2px;">${h(code)}</p>
        <p style="margin:0;font-size:13px;line-height:1.6;color:#6b6b6b;">This code is yours alone and can be used once.</p>
      </td></tr>
    </table>
  </body>
</html>`;

  const text = [heading, "", body, "", `  ${code}`, "", "This code is yours alone and can be used once."]
    .filter((line, i, all) => !(line === "" && (i === 0 || all[i - 1] === "")))
    .join("\n");

  return { subject, html, text };
}
