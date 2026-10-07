import { beforeEach, describe, expect, it, vi } from "vitest";
import { PRIMARY_DOMAIN, clearStoreUrlCache, createStoreUrlResolver } from "./store-url.server";

const admin = (url: unknown, fail = false) => ({
  graphql: vi.fn(async (q: string) => {
    expect(q).toBe(PRIMARY_DOMAIN);
    if (fail) throw new Error("network");
    return Response.json({ data: { shop: { primaryDomain: { url } } } });
  }),
});

beforeEach(clearStoreUrlCache);

describe("store url resolver", () => {
  it("uses the domain customers shop on, not the internal myshopify address", async () => {
    expect(await createStoreUrlResolver(admin("https://trekiva.com"))("kq100k-v1.myshopify.com")).toBe("https://trekiva.com");
  });

  it("drops a trailing slash", async () => {
    expect(await createStoreUrlResolver(admin("https://trekiva.com/"))("s.myshopify.com")).toBe("https://trekiva.com");
  });

  it("asks Shopify once per shop, not once per email", async () => {
    const a = admin("https://trekiva.com");
    const resolve = createStoreUrlResolver(a);
    await resolve("s.myshopify.com");
    await resolve("s.myshopify.com");
    expect(a.graphql).toHaveBeenCalledTimes(1);
  });

  it("falls back to the myshopify address when Shopify cannot be asked, and does not cache the fallback", async () => {
    expect(await createStoreUrlResolver(admin("https://trekiva.com", true))("s.myshopify.com")).toBe("https://s.myshopify.com");
    expect(await createStoreUrlResolver(admin("https://trekiva.com"))("s.myshopify.com")).toBe("https://trekiva.com");
  });

  it("never accepts an address that is not a plain https origin", async () => {
    for (const bad of ["http://trekiva.com", "javascript:alert(1)", "https://a.com/x y", null, 42, "https://evil.com/path"]) {
      clearStoreUrlCache();
      expect(await createStoreUrlResolver(admin(bad))("s.myshopify.com")).toBe("https://s.myshopify.com");
    }
  });
});
