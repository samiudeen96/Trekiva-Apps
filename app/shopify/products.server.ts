import type { AdminGraphqlClient } from "../discounts/types";
import type { EmailSection, EmailTemplate } from "../email/schema";
import type { ProductCard } from "../email/render";
import { logger } from "../utils/logger.server";
import { gql } from "./graphql.server";

type ProductSection = Extract<EmailSection, { type: "product" }>;

// onlineStoreUrl is null for a product that is not published to the Online Store, which is exactly the
// product a customer could not open, so those are dropped below.
const FIELDS = `
  id
  title
  onlineStoreUrl
  featuredMedia { preview { image { url altText } } }
  priceRangeV2 { minVariantPrice { amount currencyCode } }
`;

export const NEWEST = `#graphql
  query TrekivaNewestProducts($n: Int!) {
    products(first: $n, sortKey: CREATED_AT, reverse: true, query: "status:active") { nodes { ${FIELDS} } }
  }
`;
export const COLLECTION = `#graphql
  query TrekivaCollectionProducts($id: ID!, $n: Int!, $sort: ProductCollectionSortKeys!, $reverse: Boolean!) {
    collection(id: $id) { products(first: $n, sortKey: $sort, reverse: $reverse) { nodes { ${FIELDS} } } }
  }
`;
export const PICKED = `#graphql
  query TrekivaPickedProducts($ids: [ID!]!) {
    nodes(ids: $ids) { ... on Product { ${FIELDS} } }
  }
`;

interface RawProduct {
  id?: string;
  title?: string;
  onlineStoreUrl?: string | null;
  featuredMedia?: { preview?: { image?: { url?: string; altText?: string | null } | null } | null } | null;
  priceRangeV2?: { minVariantPrice?: { amount: string; currencyCode: string } } | null;
}

export function formatPrice(amount: string, currency: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "";
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

/** A smaller copy of the image, so the email stays light. Non-https or odd urls are dropped. */
function sized(url: string | undefined): string {
  if (!url || !/^https:\/\//i.test(url)) return "";
  try {
    const u = new URL(url);
    u.searchParams.set("width", "480");
    return u.toString();
  } catch {
    return "";
  }
}

export function toCard(p: RawProduct | null | undefined): ProductCard | null {
  if (!p?.title || !p.onlineStoreUrl || !/^https:\/\//i.test(p.onlineStoreUrl)) return null;
  const price = p.priceRangeV2?.minVariantPrice;
  return {
    title: p.title,
    url: p.onlineStoreUrl,
    imageUrl: sized(p.featuredMedia?.preview?.image?.url),
    imageAlt: p.featuredMedia?.preview?.image?.altText ?? p.title,
    price: price ? formatPrice(price.amount, price.currencyCode) : "",
  };
}

async function load(admin: AdminGraphqlClient, s: ProductSection): Promise<ProductCard[]> {
  // A few extra, because unpublished products are dropped after the fact.
  const n = Math.min(s.count + 4, 12);
  let raw: RawProduct[] = [];
  if (s.source === "newest") {
    raw = (await gql(admin, NEWEST, { n })).products.nodes;
  } else if (s.source === "collection") {
    if (!s.collectionId) return [];
    const sort = s.collectionSort === "best_selling" ? "BEST_SELLING" : s.collectionSort === "manual" ? "COLLECTION_DEFAULT" : "CREATED";
    const data = await gql(admin, COLLECTION, { id: s.collectionId, n, sort, reverse: s.collectionSort === "newest" });
    raw = data.collection?.products.nodes ?? [];
  } else {
    if (s.productIds.length === 0) return [];
    // nodes() keeps the order the merchant picked and returns null for a product that was deleted.
    raw = (await gql(admin, PICKED, { ids: s.productIds })).nodes;
  }
  const cards = raw.map(toCard).filter((c): c is ProductCard => c !== null);
  return cards.slice(0, s.source === "static" ? 8 : s.count);
}

/**
 * Looks up the products for every product section of a template. The products are decoration, so a failure
 * here (missing permission, Shopify down) never stops the email that carries the customer's code: that
 * section is simply left out.
 */
export function createProductResolver(admin: AdminGraphqlClient) {
  return async (template: EmailTemplate): Promise<Record<string, ProductCard[]>> => {
    const sections = template.sections.filter((s): s is ProductSection => s.type === "product");
    const out: Record<string, ProductCard[]> = {};
    await Promise.all(
      sections.map(async (s) => {
        try {
          out[s.id] = await load(admin, s);
        } catch (err) {
          logger.warn({ err, section: s.id }, "could not load products for the welcome email; leaving them out");
          out[s.id] = [];
        }
      }),
    );
    return out;
  };
}
