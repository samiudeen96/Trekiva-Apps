import type { AdminGraphqlClient } from "../discounts/types";

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Runs an Admin GraphQL operation; throws on top-level errors or missing data. */
export async function gql(admin: AdminGraphqlClient, query: string, variables: Record<string, unknown>) {
  const res = await admin.graphql(query, { variables });
  const json = (await res.json()) as { data?: any; errors?: unknown };
  if (json.errors || !json.data) {
    throw new Error(`Shopify GraphQL error: ${JSON.stringify(json.errors ?? "no data")}`);
  }
  return json.data;
}
