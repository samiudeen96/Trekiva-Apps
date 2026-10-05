import { env } from "../utils/env.server";
import type { EmailGateway, FulfilmentInput } from "../claims/types";
import { renderWelcomeOffer, senderName, type EmailBranding } from "./template";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** Brand name and logo the email (and the editor's preview of it) are rendered with. */
export function getEmailBranding(): EmailBranding {
  return {
    brand: senderName(env.EMAIL_FROM) ?? "our store",
    logoUrl: env.EMAIL_LOGO_URL,
  };
}

/**
 * Sends the claim's code through Resend. Called ONLY by the request that won the first-claim
 * insert; throws on any failure so the claim is marked FAILED and can be retried.
 */
export function createEmailGateway(fetchImpl: typeof fetch = fetch): EmailGateway {
  return {
    async sendWelcomeOffer(input: FulfilmentInput) {
      const { subject, html, text } = renderWelcomeOffer({
        content: input.emailContent,
        discountCode: input.discountCode,
        branding: getEmailBranding(),
      });
      const res = await fetchImpl(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
          // A retried claim must never produce a second email.
          "Idempotency-Key": `welcome-offer-${input.claimId}`,
        },
        body: JSON.stringify({
          from: env.EMAIL_FROM,
          to: [input.email],
          subject,
          html,
          text,
          ...(env.EMAIL_REPLY_TO ? { reply_to: env.EMAIL_REPLY_TO } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Resend rejected the welcome email (${res.status}): ${body}`);
      }
    },
  };
}
