import { describe, expect, it, vi } from "vitest";
import { COLLECTION, NEWEST, PICKED, createProductResolver, formatPrice, toCard } from "./products.server";
import { defaultEmail, newSection } from "../email/defaults";
import type { EmailTemplate } from "../email/schema";

const raw = (n: number, over: object = {}) => ({
  id: `gid://shopify/Product/${n}`,
  title: `Sandal ${n}`,
  onlineStoreUrl: `https://trekiva.com/products/sandal-${n}`,
  featuredMedia: { preview: { image: { url: `https://cdn.shopify.com/s/files/${n}.jpg?v=1`, altText: `Alt ${n}` } } },
  priceRangeV2: { minVariantPrice: { amount: "999.0", currencyCode: "INR" } },
  ...over,
});

const section = (patch: object) => ({ ...newSection("product"), id: "p1", ...patch }) as Extract<EmailTemplate["sections"][number], { type: "product" }>;
const tpl = (s: object): EmailTemplate => ({ ...defaultEmail, sections: [...defaultEmail.sections, s as EmailTemplate["sections"][number]] });

function admin(handlers: Record<string, (v: Record<string, unknown>) => object>) {
  return {
    graphql: vi.fn(async (q: string, o?: { variables?: Record<string, unknown> }) => {
      const h = handlers[q];
      if (!h) throw new Error("unexpected query");
      return Response.json({ data: h(o?.variables ?? {}) });
    }),
  };
}

describe("product cards", () => {
  it("keeps what the email needs, with a smaller image", () => {
    const c = toCard(raw(1))!;
    expect(c).toMatchObject({ title: "Sandal 1", url: "https://trekiva.com/products/sandal-1", imageAlt: "Alt 1" });
    expect(c.imageUrl).toBe("https://cdn.shopify.com/s/files/1.jpg?v=1&width=480");
    expect(c.price).toMatch(/999\.00/);
  });

  it("drops a product that is not on the online store, or has no usable link", () => {
    expect(toCard(raw(1, { onlineStoreUrl: null }))).toBeNull();
    expect(toCard(raw(1, { onlineStoreUrl: "http://insecure.example/p" }))).toBeNull();
    expect(toCard(raw(1, { onlineStoreUrl: "javascript:alert(1)" }))).toBeNull();
    expect(toCard(null)).toBeNull();
  });

  it("copes with no image or price", () => {
    const c = toCard(raw(1, { featuredMedia: null, priceRangeV2: null }))!;
    expect(c.imageUrl).toBe("");
    expect(c.price).toBe("");
    expect(toCard(raw(1, { featuredMedia: { preview: { image: { url: "http://x/y.jpg" } } } }))!.imageUrl).toBe("");
  });

  it("formats prices in the shop currency, and survives a bad currency", () => {
    expect(formatPrice("1299", "INR")).toContain("1,299.00");
    expect(formatPrice("5", "NOPE")).toBe("5.00 NOPE");
    expect(formatPrice("abc", "INR")).toBe("");
  });
});

describe("product resolver", () => {
  it("loads the newest products and trims to the count after dropping unpublished ones", async () => {
    const a = admin({ [NEWEST]: () => ({ products: { nodes: [raw(1), raw(2, { onlineStoreUrl: null }), raw(3), raw(4)] } }) });
    const out = await createProductResolver(a)(tpl(section({ source: "newest", count: 2 })));
    expect(out.p1.map((c) => c.title)).toEqual(["Sandal 1", "Sandal 3"]);
  });

  it("loads a collection in the chosen order", async () => {
    const a = admin({ [COLLECTION]: () => ({ collection: { products: { nodes: [raw(1)] } } }) });
    const s = section({ source: "collection", collectionId: "gid://shopify/Collection/9", collectionSort: "best_selling" });
    await createProductResolver(a)(tpl(s));
    const vars = (a.graphql.mock.calls[0] as unknown as [string, { variables: Record<string, unknown> }])[1].variables;
    expect(vars).toMatchObject({ id: "gid://shopify/Collection/9", sort: "BEST_SELLING", reverse: false });

    const b = admin({ [COLLECTION]: () => ({ collection: { products: { nodes: [] } } }) });
    await createProductResolver(b)(tpl({ ...s, collectionSort: "newest" }));
    expect((b.graphql.mock.calls[0] as unknown as [string, { variables: Record<string, unknown> }])[1].variables).toMatchObject({ sort: "CREATED", reverse: true });
  });

  it("shows nothing for a collection that was deleted or never chosen", async () => {
    const gone = admin({ [COLLECTION]: () => ({ collection: null }) });
    expect((await createProductResolver(gone)(tpl(section({ source: "collection", collectionId: "gid://shopify/Collection/9" })))).p1).toEqual([]);
    const none = admin({});
    expect((await createProductResolver(none)(tpl(section({ source: "collection", collectionId: null })))).p1).toEqual([]);
    expect(none.graphql).not.toHaveBeenCalled();
  });

  it("keeps hand-picked products in the picked order and skips deleted ones", async () => {
    const a = admin({ [PICKED]: () => ({ nodes: [raw(3), null, raw(1)] }) });
    const s = section({ source: "static", productIds: ["gid://shopify/Product/3", "gid://shopify/Product/2", "gid://shopify/Product/1"] });
    expect((await createProductResolver(a)(tpl(s))).p1.map((c) => c.title)).toEqual(["Sandal 3", "Sandal 1"]);
  });

  it("never throws: a failed lookup just leaves that section empty", async () => {
    const boom = { graphql: vi.fn(async () => { throw new Error("Access denied: read_products"); }) };
    expect((await createProductResolver(boom)(tpl(section({ source: "newest" })))).p1).toEqual([]);
  });

  it("does nothing for a template without product sections", async () => {
    const a = admin({});
    expect(await createProductResolver(a)(defaultEmail)).toEqual({});
    expect(a.graphql).not.toHaveBeenCalled();
  });
});
