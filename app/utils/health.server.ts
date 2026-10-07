import db from "../db.server";
import type { AdminGraphqlClient } from "../discounts/types";
import { missingMetafieldDefinitions } from "../shopify/handoff.server";
import { env } from "./env.server";

export interface Check {
  ok: boolean;
  detail: string;
}

// Webhooks are declared in shopify.app.toml; Shopify does not expose those config-managed
// subscriptions through webhookSubscriptions, so there is nothing reliable to check here.
export const SHOP_QUERY = `#graphql
  query TrekivaShop {
    shop { name myshopifyDomain }
  }
`;

/** Required scopes not covered by the granted ones. Shopify reports only write_x when it grants write_x, which includes read_x. */
export function missingScopes(required: string[], grantedScope: string | undefined): string[] {
  const granted = new Set((grantedScope ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  return required.filter((s) => !granted.has(s) && !(s.startsWith("read_") && granted.has(`write_${s.slice(5)}`)));
}

export async function checkDatabase(): Promise<Check> {
  const started = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return { ok: true, detail: `Connected (${Date.now() - started} ms)` };
  } catch {
    return { ok: false, detail: "Cannot reach PostgreSQL" };
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function checkShopify(
  admin: AdminGraphqlClient,
  grantedScope: string | undefined,
): Promise<{ shopify: Check; scopes: Check }> {
  const missing = missingScopes(env.SCOPES, grantedScope);
  const scopes: Check = missing.length
    ? { ok: false, detail: `Missing scopes: ${missing.join(", ")}. Re-approve the app.` }
    : { ok: true, detail: env.SCOPES.join(", ") };

  try {
    const res = await admin.graphql(SHOP_QUERY);
    const json = (await res.json()) as { data?: any; errors?: unknown };
    if (json.errors || !json.data) throw new Error("graphql");
    return {
      shopify: { ok: true, detail: `Connected to ${json.data.shop.name} (${json.data.shop.myshopifyDomain})` },
      scopes,
    };
  } catch {
    return {
      shopify: { ok: false, detail: "Shopify Admin API request failed" },
      scopes,
    };
  }
}

export interface DiscountLookupResult {
  status: "ACTIVE" | "EXPIRED" | "SCHEDULED";
}

/**
 * Every active campaign adds its claims' codes to one Shopify discount, so a discount that was
 * deleted, expired or not started yet makes every claim fail. `lookup` returns null when Shopify
 * no longer has the discount.
 */
export async function checkCampaignDiscounts(
  campaigns: { name: string; discountId: string | null }[],
  lookup: (discountId: string) => Promise<DiscountLookupResult | null>,
): Promise<Check> {
  if (campaigns.length === 0) return { ok: true, detail: "No active campaigns" };

  const problems: string[] = [];
  for (const c of campaigns) {
    if (!c.discountId) {
      problems.push(`"${c.name}" has no discount selected`);
      continue;
    }
    try {
      const found = await lookup(c.discountId);
      if (!found) problems.push(`"${c.name}": its discount no longer exists in Shopify`);
      else if (found.status === "EXPIRED") problems.push(`"${c.name}": its discount has expired`);
      else if (found.status === "SCHEDULED") problems.push(`"${c.name}": its discount has not started yet`);
    } catch {
      problems.push(`"${c.name}": could not check its discount`);
    }
  }
  return problems.length
    ? { ok: false, detail: problems.join(". ") }
    : { ok: true, detail: `${campaigns.length} active campaign(s): discount is live` };
}

/**
 * The app writes customer metafields and tags and adds discount codes, all of which need a write
 * scope. Shopify has no read-only probe for these, and a test write on a real customer on every
 * page load would have side effects, so the grant itself is what is checked.
 */
export function checkWriteAccess(grantedScope: string | undefined): {
  customers: Check;
  discounts: Check;
} {
  const need = (scope: string, ok: string, bad: string): Check =>
    missingScopes([scope], grantedScope).length ? { ok: false, detail: bad } : { ok: true, detail: ok };
  return {
    customers: need(
      "write_customers",
      "write_customers granted: Trekiva can find or create customers, write metafields and add the Flow tag",
      "write_customers is missing, so customers, metafields and the Flow tag cannot be written. Re-approve the app.",
    ),
    discounts: need(
      "write_discounts",
      "write_discounts granted: Trekiva can add each claim's code to your discount",
      "write_discounts is missing, so claim codes cannot be added. Re-approve the app.",
    ),
  };
}

export async function checkMetafieldDefinitions(admin: AdminGraphqlClient): Promise<Check & { missing: string[] }> {
  try {
    const missing = await missingMetafieldDefinitions(admin);
    return missing.length
      ? { ok: false, missing, detail: `Missing definitions for trekiva.${missing.join(", trekiva.")}. Use "Create metafield definitions" below.` }
      : { ok: true, missing, detail: "All trekiva.* customer metafield definitions exist" };
  } catch {
    return { ok: false, missing: [], detail: "Could not read metafield definitions from Shopify" };
  }
}
