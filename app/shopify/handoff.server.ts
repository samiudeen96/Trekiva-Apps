import type { AdminGraphqlClient } from "../discounts/types";
import { CLAIM_METAFIELDS, METAFIELD_NAMESPACE, TAG_EMAIL_SENT, tagList } from "../claims/handoff";
import { gql } from "./graphql.server";

export const LIST_DEFINITIONS = `#graphql
  query TrekivaMetafieldDefinitions($namespace: String!) {
    metafieldDefinitions(ownerType: CUSTOMER, namespace: $namespace, first: 50) {
      nodes { key type { name } }
    }
  }
`;

export const CREATE_DEFINITION = `#graphql
  mutation TrekivaCreateMetafieldDefinition($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition { id }
      userErrors { field message code }
    }
  }
`;

export const CUSTOMER_TAGS = `#graphql
  query TrekivaCustomerTags($id: ID!) {
    customer(id: $id) { tags }
  }
`;

/** Keys of the trekiva.* customer metafields that have no definition (or the wrong type) yet. */
export async function missingMetafieldDefinitions(admin: AdminGraphqlClient): Promise<string[]> {
  const data = await gql(admin, LIST_DEFINITIONS, { namespace: METAFIELD_NAMESPACE });
  const have = new Map<string, string>(
    (data.metafieldDefinitions.nodes as { key: string; type: { name: string } }[]).map((d) => [d.key, d.type.name]),
  );
  return CLAIM_METAFIELDS.filter((m) => have.get(m.key) !== m.type).map((m) => m.key);
}

export interface EnsureResult {
  created: string[];
  failed: { key: string; message: string }[];
}

/**
 * Creates the missing definitions. Safe to repeat: existing ones are skipped, and a definition
 * that exists with a different type is reported rather than overwritten.
 */
export async function ensureMetafieldDefinitions(admin: AdminGraphqlClient): Promise<EnsureResult> {
  const missing = new Set(await missingMetafieldDefinitions(admin));
  const result: EnsureResult = { created: [], failed: [] };
  for (const m of CLAIM_METAFIELDS.filter((x) => missing.has(x.key))) {
    const data = await gql(admin, CREATE_DEFINITION, {
      definition: {
        name: m.name,
        description: m.description,
        namespace: METAFIELD_NAMESPACE,
        key: m.key,
        type: m.type,
        ownerType: "CUSTOMER",
      },
    });
    const errs = data.metafieldDefinitionCreate.userErrors as { message: string }[];
    if (errs?.length) result.failed.push({ key: m.key, message: errs.map((e) => e.message).join("; ") });
    else result.created.push(m.key);
  }
  return result;
}

/** True when Flow has marked this customer's welcome email as processed. */
export async function hasEmailSentTag(admin: AdminGraphqlClient, customerId: string): Promise<boolean> {
  const data = await gql(admin, CUSTOMER_TAGS, { id: customerId });
  return tagList((data.customer?.tags ?? []).join(",")).includes(TAG_EMAIL_SENT);
}
