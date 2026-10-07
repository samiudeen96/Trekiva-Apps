import type { AdminGraphqlClient } from "../discounts/types";
import { logger } from "../utils/logger.server";
import { gql } from "./graphql.server";

export const PRIMARY_DOMAIN = `#graphql
  query TrekivaPrimaryDomain {
    shop { primaryDomain { url } }
  }
`;

const TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { url: string; at: number }>();

/** Test hook: forget what was learned about a shop. */
export function clearStoreUrlCache() {
  cache.clear();
}

/**
 * The address customers actually shop on (e.g. https://trekiva.com), without a trailing slash.
 * Discount links must use it: Shopify Email's own links do, and the internal *.myshopify.com address did not
 * apply the code. Falls back to the myshopify address if Shopify cannot be asked, and only a real answer is cached.
 */
export function createStoreUrlResolver(admin: AdminGraphqlClient) {
  return async (shopDomain: string): Promise<string> => {
    const hit = cache.get(shopDomain);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.url;
    try {
      const data = await gql(admin, PRIMARY_DOMAIN, {});
      const raw: unknown = data.shop?.primaryDomain?.url;
      if (typeof raw === "string" && /^https:\/\/[^\s/]+\/?$/i.test(raw)) {
        const url = raw.replace(/\/$/, "");
        cache.set(shopDomain, { url, at: Date.now() });
        return url;
      }
    } catch (err) {
      logger.warn({ err, shopDomain }, "could not read the store's primary domain; using the myshopify address");
    }
    return `https://${shopDomain}`;
  };
}
