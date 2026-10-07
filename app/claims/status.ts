import type { EmailEligibility, EmailStatus } from "@prisma/client";

export type Tone = "neutral" | "info" | "success" | "warning" | "critical";

/**
 * One label for the admin lists. Claim validity and email deliverability are separate: a
 * customer who is not subscribed still holds a valid code, but Shopify Email will not send to them.
 * Legacy statuses (TRIGGERED, SENT, NOT_SUBSCRIBED) belong to claims made before the tag handoff.
 */
export function emailBadge(status: EmailStatus, eligibility: EmailEligibility): { label: string; tone: Tone } {
  switch (status) {
    case "FAILED":
      return { label: "Failed", tone: "critical" };
    case "PENDING":
      return { label: "Pending", tone: "neutral" };
    case "EMAIL_SENT":
      return { label: "Email sent", tone: "success" };
    case "READY_FOR_FLOW":
      if (eligibility === "NOT_SUBSCRIBED") return { label: "Not subscribed", tone: "warning" };
      if (eligibility === "UNKNOWN") return { label: "Waiting for Flow (consent unknown)", tone: "info" };
      return { label: "Waiting for Flow", tone: "info" };
    case "TRIGGERED":
      return { label: "Flow triggered (legacy)", tone: "info" };
    case "SENT":
      return { label: "Sent (legacy)", tone: "success" };
    case "NOT_SUBSCRIBED":
      return { label: "Not subscribed", tone: "warning" };
  }
}

export const eligibilityLabel: Record<EmailEligibility, string> = {
  SUBSCRIBED: "Subscribed",
  NOT_SUBSCRIBED: "Not subscribed",
  UNKNOWN: "Unknown",
};

/** Claim-side state, independent of email: did the app finish handing the claim to Shopify Flow? */
export function handoffLabel(flowHandoffAt: Date | string | null, status: EmailStatus): string {
  if (flowHandoffAt || status === "TRIGGERED" || status === "SENT" || status === "NOT_SUBSCRIBED") return "Ready";
  return status === "FAILED" ? "Failed" : "Pending";
}
