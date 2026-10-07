import { describe, expect, it } from "vitest";
import { deliveryBucket, delta, fillDays, niceMax, summarizeDelivery, windowStart } from "./metrics";

const NOW = Date.UTC(2026, 9, 7, 15, 30); // 7 Oct 2026, mid-afternoon UTC

describe("fillDays", () => {
  it("gives one entry per day, oldest first, ending today, with empty days as 0", () => {
    const days = fillDays([{ day: "2026-10-05", n: 4 }, { day: "2026-10-07", n: 1 }], 5, NOW);
    expect(days).toEqual([
      { date: "2026-10-03", count: 0 },
      { date: "2026-10-04", count: 0 },
      { date: "2026-10-05", count: 4 },
      { date: "2026-10-06", count: 0 },
      { date: "2026-10-07", count: 1 },
    ]);
  });

  it("ignores rows outside the window and crosses month and year ends", () => {
    expect(fillDays([{ day: "2026-01-01", n: 9 }], 3, NOW).map((d) => d.count)).toEqual([0, 0, 0]);
    expect(fillDays([], 3, Date.UTC(2027, 0, 1, 1)).map((d) => d.date)).toEqual(["2026-12-30", "2026-12-31", "2027-01-01"]);
  });
});

describe("windowStart", () => {
  it("is midnight UTC of the oldest day shown, so the query and the chart agree", () => {
    expect(windowStart(14, NOW).toISOString()).toBe("2026-09-24T00:00:00.000Z");
    expect(windowStart(1, NOW).toISOString()).toBe("2026-10-07T00:00:00.000Z");
    expect(fillDays([], 14, NOW)[0].date).toBe("2026-09-24");
  });
});

describe("niceMax", () => {
  it("stays tight to the data and always yields a whole-number middle gridline", () => {
    expect(niceMax(0)).toBe(2);
    expect(niceMax(1)).toBe(2);
    expect(niceMax(5)).toBe(6);
    expect(niceMax(9)).toBe(10);
    expect(niceMax(13)).toBe(16);
    expect(niceMax(20)).toBe(20);
    expect(niceMax(21)).toBe(30);
    expect(niceMax(37)).toBe(40);
    expect(niceMax(99)).toBe(100);
    expect(niceMax(101)).toBe(120);
    expect(niceMax(4300)).toBe(4400);
    for (const m of [0, 1, 3, 5, 7, 13, 21, 37, 99, 101, 640, 4300, 99999]) {
      const top = niceMax(m);
      expect(top).toBeGreaterThanOrEqual(m);
      expect(Number.isInteger(top / 2)).toBe(true);
    }
  });
});

describe("delta", () => {
  it("compares with the previous period, up being good", () => {
    expect(delta(12, 10)).toEqual({ label: "▲ 20%", tone: "success" });
    expect(delta(5, 10)).toEqual({ label: "▼ 50%", tone: "critical" });
    expect(delta(10, 10)).toEqual({ label: "No change", tone: "neutral" });
  });

  it("does not divide by zero", () => {
    expect(delta(0, 0)).toEqual({ label: "No change", tone: "neutral" });
    expect(delta(3, 0)).toEqual({ label: "▲ New", tone: "success" });
    expect(delta(0, 4)).toEqual({ label: "▼ 100%", tone: "critical" });
  });

  it("never says 0% for a tiny change", () => {
    expect(delta(1001, 1000).label).toBe("No change");
  });
});

describe("delivery buckets", () => {
  it("buckets every status", () => {
    expect(deliveryBucket("EMAIL_SENT", "SUBSCRIBED")).toBe("sent");
    expect(deliveryBucket("SENT", "UNKNOWN")).toBe("sent");
    expect(deliveryBucket("FAILED", "NOT_SUBSCRIBED")).toBe("failed");
    expect(deliveryBucket("PENDING", "UNKNOWN")).toBe("waiting");
    expect(deliveryBucket("READY_FOR_FLOW", "SUBSCRIBED")).toBe("waiting");
    expect(deliveryBucket("TRIGGERED", "SUBSCRIBED")).toBe("waiting");
  });

  it("counts an unsubscribed customer the app emailed as sent: they got the code-only message", () => {
    expect(deliveryBucket("EMAIL_SENT", "NOT_SUBSCRIBED")).toBe("sent");
  });

  it("flags a customer Flow will never email", () => {
    expect(deliveryBucket("READY_FOR_FLOW", "NOT_SUBSCRIBED")).toBe("notSubscribed");
    expect(deliveryBucket("NOT_SUBSCRIBED", "UNKNOWN")).toBe("notSubscribed");
  });

  it("sums rows into the four buckets", () => {
    expect(
      summarizeDelivery([
        { status: "EMAIL_SENT", eligibility: "SUBSCRIBED", n: 5 },
        { status: "EMAIL_SENT", eligibility: "NOT_SUBSCRIBED", n: 2 },
        { status: "READY_FOR_FLOW", eligibility: "SUBSCRIBED", n: 1 },
        { status: "READY_FOR_FLOW", eligibility: "NOT_SUBSCRIBED", n: 3 },
        { status: "FAILED", eligibility: "UNKNOWN", n: 1 },
      ]),
    ).toEqual({ sent: 7, waiting: 1, notSubscribed: 3, failed: 1 });
    expect(summarizeDelivery([])).toEqual({ sent: 0, waiting: 0, notSubscribed: 0, failed: 0 });
  });
});
