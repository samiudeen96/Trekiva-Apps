import type { EmailEligibility, EmailStatus } from "@prisma/client";

// Pure (no server imports): the dashboard's numbers, kept out of the route so they can be tested.

export interface DayCount {
  /** YYYY-MM-DD, UTC */
  date: string;
  count: number;
}

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const startOfUtcDay = (t: number) => Math.floor(t / DAY) * DAY;

/** The first instant of the oldest day shown, so a query and the chart cover the same window. */
export function windowStart(days: number, now = Date.now()): Date {
  return new Date(startOfUtcDay(now) - (days - 1) * DAY);
}

/** One entry per day, oldest first, with days that had no claims filled in as 0. */
export function fillDays(rows: { day: string; n: number }[], days: number, now = Date.now()): DayCount[] {
  const byDay = new Map(rows.map((r) => [r.day, r.n]));
  return Array.from({ length: days }, (_, i) => {
    const date = iso(startOfUtcDay(now) - (days - 1 - i) * DAY);
    return { date, count: byDay.get(date) ?? 0 };
  });
}

/**
 * The top of the y axis: tight to the data, a round number, and even so the middle gridline is whole too
 * (a peak of 5 gives 6, 13 gives 16, 37 gives 40, 101 gives 120).
 */
export function niceMax(max: number): number {
  if (max <= 10) return Math.max(2, Math.ceil(max / 2) * 2);
  if (max <= 20) return Math.ceil(max / 4) * 4;
  const pow = 10 ** Math.floor(Math.log10(max));
  const unit = max < 100 ? pow : pow / 5;
  return Math.ceil(max / unit) * unit;
}

export interface Delta {
  label: string;
  tone: "success" | "critical" | "neutral";
}

/** Change against the previous period. More claims is good, so up is green; the arrow keeps it from being colour alone. */
export function delta(current: number, previous: number): Delta {
  if (current === 0 && previous === 0) return { label: "No change", tone: "neutral" };
  if (previous === 0) return { label: "▲ New", tone: "success" };
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return { label: "No change", tone: "neutral" };
  return pct > 0 ? { label: `▲ ${pct}%`, tone: "success" } : { label: `▼ ${Math.abs(pct)}%`, tone: "critical" };
}

export type DeliveryBucket = "sent" | "waiting" | "notSubscribed" | "failed";

/**
 * Where a claim stands on email, in four buckets. A claim the app emailed is "sent" even for a customer who is
 * not subscribed (they got the code-only message); one waiting on Shopify Flow who is not subscribed will never
 * be emailed, so it is called out. Legacy statuses fold into the same buckets.
 */
export function deliveryBucket(status: EmailStatus, eligibility: EmailEligibility): DeliveryBucket {
  if (status === "FAILED") return "failed";
  if (status === "EMAIL_SENT" || status === "SENT") return "sent";
  if (status === "NOT_SUBSCRIBED" || eligibility === "NOT_SUBSCRIBED") return "notSubscribed";
  return "waiting";
}

export function summarizeDelivery(
  rows: { status: EmailStatus; eligibility: EmailEligibility; n: number }[],
): Record<DeliveryBucket, number> {
  const out: Record<DeliveryBucket, number> = { sent: 0, waiting: 0, notSubscribed: 0, failed: 0 };
  for (const r of rows) out[deliveryBucket(r.status, r.eligibility)] += r.n;
  return out;
}
