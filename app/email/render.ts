import type { EmailSection, EmailTemplate } from "./schema";
import { defaultEmail } from "./defaults";

// Pure (no server imports): used by the sender, the test-email action and the editor's preview.

export interface EmailVars {
  code: string;
  /** https://<shop>/discount/<CODE>: applies the code, then lands on the home page. */
  discountBase: string;
  shopName: string;
  /** https://<shop>/ */
  shopUrl: string;
  firstName: string | null;
  /** Null for a customer who is not subscribed: they get no marketing footer or unsubscribe link. */
  unsubscribeUrl: string | null;
}

/** "full" is the merchant's template. "codeOnly" is the minimal message for someone not subscribed to marketing. */
export type EmailMode = "full" | "codeOnly";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);
const PLACEHOLDER = /\{\{\s*(code|first_name|shop_name)\s*\}\}/gi;

function values(v: EmailVars): Record<string, string> {
  return { code: v.code, first_name: v.firstName?.trim() || "there", shop_name: v.shopName };
}

/** Plain-text fill (subject, text version). One pass, so a value is never re-expanded. */
function fillPlain(s: string, v: EmailVars): string {
  const vals = values(v);
  return s.replace(PLACEHOLDER, (_, k: string) => vals[k.toLowerCase()]);
}

/** HTML fill: the merchant's text is escaped FIRST, then values (also escaped) are inserted. */
function fill(s: string, v: EmailVars): string {
  const vals = values(v);
  return esc(s).replace(PLACEHOLDER, (_, k: string) => esc(vals[k.toLowerCase()]));
}

const paragraphs = (s: string, v: EmailVars, style: string) =>
  s
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="${style}">${fill(p, v).replace(/\n/g, "<br>")}</p>`)
    .join("");

/** Only https URLs or the two link placeholders ever reach an href. */
function resolveUrl(raw: string, v: EmailVars, discountLink: string): string | null {
  const t = raw.trim();
  if (t === "{{discount_link}}") return discountLink;
  if (t === "{{shop_url}}") return v.shopUrl;
  return /^https:\/\//i.test(t) ? t : null;
}

function discountLinkFor(v: EmailVars, redirectPath: string): string {
  return redirectPath ? `${v.discountBase}?redirect=${encodeURIComponent(redirectPath)}` : v.discountBase;
}

const FONTS = {
  sans: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
  serif: "Georgia,'Times New Roman',Times,serif",
} as const;

function button(label: string, href: string, t: EmailTemplate, align: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" align="${align}" style="margin:8px ${align === "center" ? "auto" : "0"};"><tr><td bgcolor="${t.brand.buttonColor}" style="border-radius:6px;background:${t.brand.buttonColor};"><a href="${esc(href)}" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:600;line-height:1.2;color:${t.brand.buttonTextColor};text-decoration:none;border-radius:6px;">${esc(label)}</a></td></tr></table>`;
}

function row(inner: string, padding = "8px 32px"): string {
  return `<tr><td class="px" style="padding:${padding};">${inner}</td></tr>`;
}

function renderSection(s: EmailSection, t: EmailTemplate, v: EmailVars): string {
  const c = t.brand.textColor;
  const body = `margin:0 0 14px;font-size:16px;line-height:1.6;color:${c};`;
  switch (s.type) {
    case "header": {
      const logo = s.logoUrl
        ? `<img src="${esc(s.logoUrl)}" alt="${esc(v.shopName)}" width="${s.logoWidth}" style="display:inline-block;width:${s.logoWidth}px;max-width:100%;height:auto;border:0;">`
        : `<span style="font-size:22px;font-weight:700;color:${c};">${esc(v.shopName)}</span>`;
      return `<tr><td align="${s.align}" class="px" style="padding:24px 32px;background:${s.backgroundColor};text-align:${s.align};">${logo}</td></tr>`;
    }
    case "text": {
      const h = s.heading ? `<h1 style="margin:0 0 14px;font-size:26px;line-height:1.25;color:${c};text-align:${s.align};">${fill(s.heading, v)}</h1>` : "";
      return row(h + paragraphs(s.body, v, `${body}text-align:${s.align};`), "20px 32px 8px");
    }
    case "image": {
      if (!s.imageUrl) return "";
      const img = `<img src="${esc(s.imageUrl)}" alt="${esc(s.alt)}" width="${t.brand.width}" style="display:block;width:100%;max-width:${t.brand.width}px;height:auto;border:0;">`;
      const href = s.linkUrl ? resolveUrl(s.linkUrl, v, v.discountBase) : null;
      return `<tr><td style="padding:0;line-height:0;">${href ? `<a href="${esc(href)}">${img}</a>` : img}</td></tr>`;
    }
    case "imageText": {
      const href = s.buttonUrl ? resolveUrl(s.buttonUrl, v, v.discountBase) : null;
      const textCell = `<td class="stack" valign="middle" style="padding:0 12px;width:60%;">${
        s.heading ? `<h2 style="margin:0 0 10px;font-size:20px;line-height:1.3;color:${c};">${fill(s.heading, v)}</h2>` : ""
      }${paragraphs(s.body, v, body)}${s.buttonLabel && href ? button(s.buttonLabel, href, t, "left") : ""}</td>`;
      if (!s.imageUrl) return row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${textCell}</tr></table>`);
      const imgCell = `<td class="stack" valign="middle" style="padding:0 12px;width:40%;"><img src="${esc(s.imageUrl)}" alt="${esc(s.alt)}" width="220" style="display:block;width:100%;height:auto;border:0;"></td>`;
      return row(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${s.imagePosition === "left" ? imgCell + textCell : textCell + imgCell}</tr></table>`,
        "16px 20px",
      );
    }
    case "discount": {
      const link = discountLinkFor(v, s.redirectPath);
      return row(
        `${s.heading ? `<h2 style="margin:0 0 10px;font-size:22px;line-height:1.3;color:${c};text-align:center;">${fill(s.heading, v)}</h2>` : ""}${
          s.description ? paragraphs(s.description, v, `${body}text-align:center;`) : ""
        }<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 14px;"><tr><td align="center" bgcolor="${t.brand.buttonColor}" style="padding:20px;background:${t.brand.buttonColor};border-radius:8px;font-family:'SFMono-Regular',Menlo,Consolas,'Courier New',monospace;font-size:24px;font-weight:700;letter-spacing:2px;color:${t.brand.buttonTextColor};">${esc(v.code)}</td></tr></table>${
          s.buttonLabel ? button(s.buttonLabel, link, t, "center") : ""
        }${s.note ? `<p style="margin:14px 0 0;font-size:13px;line-height:1.5;color:${c};opacity:.7;text-align:center;">${fill(s.note, v)}</p>` : ""}`,
        "16px 32px",
      );
    }
    case "button": {
      const href = resolveUrl(s.url, v, v.discountBase);
      return href ? row(button(s.label, href, t, s.align)) : "";
    }
    case "columns": {
      const w = Math.floor(100 / s.items.length);
      const cells = s.items
        .map(
          (i) =>
            `<td class="stack" valign="top" style="width:${w}%;padding:8px 10px;"><p style="margin:0 0 6px;font-size:16px;font-weight:700;color:${c};">${fill(i.title, v)}</p><p style="margin:0;font-size:14px;line-height:1.5;color:${c};opacity:.8;">${fill(i.text, v)}</p></td>`,
        )
        .join("");
      return row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table>`, "12px 22px");
    }
  }
}

function footer(t: EmailTemplate, v: EmailVars): string {
  const style = `margin:0 0 8px;font-size:12px;line-height:1.6;color:${t.brand.textColor};opacity:.65;text-align:center;`;
  const address = t.footer.address ? `<p style="${style}">${fill(t.footer.address, v).replace(/\n/g, "<br>")}</p>` : "";
  // The unsubscribe link is fixed: it cannot be edited out of a marketing email.
  const why = v.unsubscribeUrl
    ? `<p style="${style}">You are receiving this because you signed up at ${esc(v.shopName)}. <a href="${esc(v.unsubscribeUrl)}" style="color:inherit;text-decoration:underline;">Unsubscribe</a></p>`
    : `<p style="${style}">You are receiving this one-time email because you asked for a welcome offer from ${esc(v.shopName)}. You are not subscribed to marketing email.</p>`;
  return `<tr><td class="px" style="padding:20px 32px 28px;border-top:1px solid #e5e5e5;">${address}${why}</td></tr>`;
}

export interface RenderedEmail {
  subject: string;
  previewText: string;
  html: string;
  text: string;
}

export function renderEmail(input: { template: EmailTemplate; vars: EmailVars; mode?: EmailMode }): RenderedEmail {
  const { vars: v } = input;
  const mode = input.mode ?? "full";
  const t = input.template;

  let sections: EmailSection[] = mode === "codeOnly" ? t.sections.filter((s) => s.type === "header" || s.type === "discount") : t.sections;
  // The code must always be in the email, even for a template stored without a discount section.
  if (!sections.some((s) => s.type === "discount")) sections = [...sections, defaultEmail.sections[2]];

  const subject = fillPlain(t.subject, v).replace(/\s+/g, " ").trim();
  const previewText = mode === "codeOnly" ? "Your welcome discount code" : fillPlain(t.previewText, v).replace(/\s+/g, " ").trim();
  const font = FONTS[t.brand.fontFamily];
  const rows = sections.map((s) => renderSection(s, t, v)).join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light">
<title>${esc(subject)}</title>
<style>@media only screen and (max-width:620px){.stack{display:block!important;width:100%!important;box-sizing:border-box;padding:8px 0!important}.px{padding-left:20px!important;padding-right:20px!important}}</style>
</head>
<body style="margin:0;padding:0;background:${t.brand.backgroundColor};font-family:${font};">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(previewText)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${t.brand.backgroundColor}" style="background:${t.brand.backgroundColor};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="${t.brand.width}" cellpadding="0" cellspacing="0" bgcolor="${t.brand.contentBackgroundColor}" style="width:100%;max-width:${t.brand.width}px;background:${t.brand.contentBackgroundColor};">
${rows}
${footer(t, v)}
</table>
</td></tr></table>
</body>
</html>`;

  return { subject, previewText, html, text: renderText(sections, t, v) };
}

function renderText(sections: EmailSection[], t: EmailTemplate, v: EmailVars): string {
  const parts: string[] = [];
  for (const s of sections) {
    switch (s.type) {
      case "header":
        parts.push(v.shopName);
        break;
      case "text":
        parts.push([s.heading && fillPlain(s.heading, v), fillPlain(s.body, v)].filter(Boolean).join("\n\n"));
        break;
      case "imageText":
        parts.push([s.heading && fillPlain(s.heading, v), fillPlain(s.body, v)].filter(Boolean).join("\n\n"));
        break;
      case "discount":
        parts.push(
          [s.heading && fillPlain(s.heading, v), s.description && fillPlain(s.description, v), `  ${v.code}`, s.buttonLabel && `${s.buttonLabel}: ${discountLinkFor(v, s.redirectPath)}`, s.note && fillPlain(s.note, v)]
            .filter(Boolean)
            .join("\n\n"),
        );
        break;
      case "button": {
        const href = resolveUrl(s.url, v, v.discountBase);
        if (href) parts.push(`${s.label}: ${href}`);
        break;
      }
      case "columns":
        parts.push(s.items.map((i) => `${fillPlain(i.title, v)}: ${fillPlain(i.text, v)}`).join("\n"));
        break;
      case "image":
        break;
    }
  }
  if (t.footer.address) parts.push(fillPlain(t.footer.address, v));
  parts.push(v.unsubscribeUrl ? `Unsubscribe: ${v.unsubscribeUrl}` : `You are receiving this one-time email because you asked for a welcome offer. You are not subscribed to marketing email.`);
  return parts.filter(Boolean).join("\n\n");
}
