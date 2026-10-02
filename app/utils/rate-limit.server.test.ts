import { describe, expect, it } from "vitest";
import { allowClaimAttempt } from "./rate-limit.server";

describe("allowClaimAttempt", () => {
  it("limits one IP (10/min default) without blocking another IP", async () => {
    const results = [];
    for (let i = 0; i < 12; i++) results.push(await allowClaimAttempt("rl.myshopify.com", "1.1.1.1"));
    expect(results.filter(Boolean)).toHaveLength(10);
    expect(await allowClaimAttempt("rl.myshopify.com", "2.2.2.2")).toBe(true);
  });
});
