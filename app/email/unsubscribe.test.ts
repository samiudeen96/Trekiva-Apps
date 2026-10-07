import { describe, expect, it } from "vitest";
import { signUnsubscribe, verifyUnsubscribe } from "./unsubscribe";

const SECRET = "app-secret";
const input = { shop: "shop-one.myshopify.com", customerId: "gid://shopify/Customer/123" };

describe("unsubscribe token", () => {
  it("round-trips the shop and customer", () => {
    expect(verifyUnsubscribe(signUnsubscribe(input, SECRET), SECRET)).toEqual(input);
  });

  it("is URL-safe", () => {
    expect(signUnsubscribe(input, SECRET)).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it("rejects a token signed with another secret", () => {
    expect(verifyUnsubscribe(signUnsubscribe(input, "other"), SECRET)).toBeNull();
  });

  it("cannot be re-pointed at another customer or shop", () => {
    const [, sig] = signUnsubscribe(input, SECRET).split(".");
    const forge = (p: object) => `${Buffer.from(JSON.stringify(p)).toString("base64url")}.${sig}`;
    expect(verifyUnsubscribe(forge({ s: input.shop, c: "gid://shopify/Customer/999" }), SECRET)).toBeNull();
    expect(verifyUnsubscribe(forge({ s: "other.myshopify.com", c: input.customerId }), SECRET)).toBeNull();
  });

  it("rejects malformed tokens without throwing", () => {
    for (const t of ["", "x", "a.b", "a.b.c", ".", "....", "%%%.%%%"]) expect(verifyUnsubscribe(t, SECRET)).toBeNull();
  });

  it("refuses ids that are not a customer GID or a myshopify domain, even when correctly signed", () => {
    expect(verifyUnsubscribe(signUnsubscribe({ shop: input.shop, customerId: "gid://shopify/Order/1" }, SECRET), SECRET)).toBeNull();
    expect(verifyUnsubscribe(signUnsubscribe({ shop: "evil.example.com", customerId: input.customerId }, SECRET), SECRET)).toBeNull();
  });
});
