import { describe, expect, it } from "vitest";
import { missingScopes } from "./health.server";

const required = ["read_customers", "write_customers", "read_discounts", "write_discounts"];

describe("missingScopes", () => {
  it("treats a granted write scope as covering its read scope", () => {
    expect(missingScopes(required, "write_customers,write_discounts")).toEqual([]);
  });

  it("reports scopes that are really missing", () => {
    expect(missingScopes(required, "write_customers,read_discounts")).toEqual(["write_discounts"]);
    expect(missingScopes(required, undefined)).toEqual(required);
  });
});
