import type { EmailGateway } from "../claims/types";
import { env } from "../utils/env.server";
import { renderEmail, type EmailVars } from "./render";
import type { EmailTemplate } from "./schema";
import { signUnsubscribe } from "./unsubscribe";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export interface EmailConfig {
  apiKey: string;
  /** RFC 5322 sender on a domain verified in Resend, e.g. "Trekiva <care@trekiva.com>". */
  from: string;
  replyTo?: string;
  appUrl: string;
  /** Signs unsubscribe links. */
  secret: string;
}

/** Null when Resend is not configured: the app then leaves delivery to Shopify Flow. */
export function emailConfig(): EmailConfig | null {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return null;
  return {
    apiKey: env.RESEND_API_KEY,
    from: env.EMAIL_FROM,
    replyTo: env.EMAIL_REPLY_TO,
    appUrl: env.SHOPIFY_APP_URL.replace(/\/$/, ""),
    secret: env.SHOPIFY_API_SECRET,
  };
}

/** Display name out of an RFC 5322 sender ("Trekiva <care@trekiva.com>" -> "Trekiva"). */
export function senderName(from: string): string | undefined {
  const name = from.match(/^\s*"?([^"<]*?)"?\s*</)?.[1]?.trim();
  return name || undefined;
}

export function discountBase(shopDomain: string, code: string): string {
  return `https://${shopDomain}/discount/${encodeURIComponent(code)}`;
}

export interface TestEmailInput {
  to: string;
  shopDomain: string;
  template: EmailTemplate;
}

export interface AppEmailGateway extends EmailGateway {
  sendTest(input: TestEmailInput): Promise<void>;
}

export function createEmailGateway(cfg: EmailConfig, fetchImpl: typeof fetch = fetch): AppEmailGateway {
  const shopName = (shopDomain: string) => senderName(cfg.from) ?? shopDomain;

  async function deliver(msg: {
    to: string;
    subject: string;
    html: string;
    text: string;
    headers?: Record<string, string>;
    idempotencyKey?: string;
  }) {
    const res = await fetchImpl(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
        // A retried claim must never produce a second email.
        ...(msg.idempotencyKey ? { "Idempotency-Key": msg.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: cfg.from,
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        ...(cfg.replyTo ? { reply_to: cfg.replyTo } : {}),
        ...(msg.headers ? { headers: msg.headers } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Resend rejected the email (${res.status}): ${body}`.slice(0, 500));
    }
  }

  return {
    /** Throws on any failure so the claim is marked FAILED and can be retried. */
    async sendWelcomeOffer(input) {
      const subscribed = input.emailEligibility === "SUBSCRIBED";
      const unsubscribeUrl = subscribed
        ? `${cfg.appUrl}/unsubscribe?t=${signUnsubscribe({ shop: input.shopDomain, customerId: input.customerId }, cfg.secret)}`
        : null;
      const vars: EmailVars = {
        code: input.discountCode,
        discountBase: discountBase(input.shopDomain, input.discountCode),
        shopName: shopName(input.shopDomain),
        shopUrl: `https://${input.shopDomain}/`,
        firstName: input.firstName,
        unsubscribeUrl,
      };
      // Anyone not (known to be) subscribed gets the code-only message, never marketing.
      const { subject, html, text } = renderEmail({ template: input.template, vars, mode: subscribed ? "full" : "codeOnly" });
      await deliver({
        to: input.email,
        subject,
        html,
        text,
        idempotencyKey: `welcome-offer-${input.claimId}`,
        ...(unsubscribeUrl
          ? { headers: { "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } }
          : {}),
      });
    },

    /** The merchant's unsaved template, with a sample code. Never touches a real claim. */
    async sendTest({ to, shopDomain, template }) {
      const sample = "WELCOME10-7KQ2M9XH";
      const { subject, html, text } = renderEmail({
        template,
        vars: {
          code: sample,
          discountBase: discountBase(shopDomain, sample),
          shopName: shopName(shopDomain),
          shopUrl: `https://${shopDomain}/`,
          firstName: null,
          unsubscribeUrl: "#",
        },
      });
      await deliver({ to, subject: `[Test] ${subject}`, html, text });
    },
  };
}
