import { describe, expect, it } from "vitest";
import { emailBadge, handoffLabel } from "./status";

describe("emailBadge", () => {
  it("separates a valid claim from email deliverability", () => {
    expect(emailBadge("READY_FOR_FLOW", "SUBSCRIBED")).toEqual({ label: "Waiting for Flow", tone: "info" });
    expect(emailBadge("READY_FOR_FLOW", "NOT_SUBSCRIBED")).toEqual({ label: "Not subscribed", tone: "warning" });
    expect(emailBadge("READY_FOR_FLOW", "UNKNOWN").label).toMatch(/consent unknown/);
    expect(emailBadge("EMAIL_SENT", "SUBSCRIBED")).toEqual({ label: "Email sent", tone: "success" });
    expect(emailBadge("FAILED", "UNKNOWN").tone).toBe("critical");
    expect(emailBadge("PENDING", "UNKNOWN").tone).toBe("neutral");
  });

  it("still labels claims made under the old Flow trigger", () => {
    expect(emailBadge("TRIGGERED", "SUBSCRIBED").label).toMatch(/legacy/);
    expect(emailBadge("SENT", "SUBSCRIBED").label).toMatch(/legacy/);
    expect(emailBadge("NOT_SUBSCRIBED", "NOT_SUBSCRIBED").label).toBe("Not subscribed");
  });
});

describe("handoffLabel", () => {
  it("is Ready once handed to Flow, including legacy settled claims", () => {
    expect(handoffLabel(new Date(), "READY_FOR_FLOW")).toBe("Ready");
    expect(handoffLabel(null, "TRIGGERED")).toBe("Ready");
    expect(handoffLabel(null, "FAILED")).toBe("Failed");
    expect(handoffLabel(null, "PENDING")).toBe("Pending");
  });
});
