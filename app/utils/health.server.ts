import db from "../db.server";
import type { AdminGraphqlClient } from "../discounts/types";
import { env } from "./env.server";

export interface Check {
  ok: boolean;
  detail: string;
}

export const WEBHOOKS_QUERY = `#graphql
  query TrekivaWebhooks {
    shop { name myshopifyDomain }
    webhookSubscriptions(first: 50) {
      nodes { topic endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } } }
    }
  }
`;

// Subscriptions declared in shopify.app.toml (compliance topics are managed by Shopify, not listed here).
const EXPECTED_TOPICS = ["APP_UNINSTALLED", "APP_SCOPES_UPDATE"];

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
export async function checkShopifyAndWebhooks(
  admin: AdminGraphqlClient,
  grantedScope: string | undefined,
): Promise<{ shopify: Check; webhooks: Check; scopes: Check }> {
  const granted = new Set((grantedScope ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  const missing = env.SCOPES.filter((s) => !granted.has(s));
  const scopes: Check = missing.length
    ? { ok: false, detail: `Missing scopes: ${missing.join(", ")}. Re-approve the app.` }
    : { ok: true, detail: env.SCOPES.join(", ") };

  try {
    const res = await admin.graphql(WEBHOOKS_QUERY);
    const json = (await res.json()) as { data?: any; errors?: unknown };
    if (json.errors || !json.data) throw new Error("graphql");
    const topics = new Set<string>(json.data.webhookSubscriptions.nodes.map((n: any) => n.topic));
    const absent = EXPECTED_TOPICS.filter((t) => !topics.has(t));
    return {
      shopify: { ok: true, detail: `Connected to ${json.data.shop.name} (${json.data.shop.myshopifyDomain})` },
      webhooks: absent.length
        ? { ok: false, detail: `Missing subscriptions: ${absent.join(", ")}. Run shopify app deploy.` }
        : { ok: true, detail: "app/uninstalled and app/scopes_update registered" },
      scopes,
    };
  } catch {
    return {
      shopify: { ok: false, detail: "Shopify Admin API request failed" },
      webhooks: { ok: false, detail: "Could not read webhook subscriptions" },
      scopes,
    };
  }
}
