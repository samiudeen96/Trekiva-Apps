import type { AdminGraphqlClient } from "../discounts/types";
import type { CustomerGateway } from "../claims/types";
import { logger } from "../utils/logger.server";

export const FIND_CUSTOMER = `#graphql
  query TrekivaFindCustomer($query: String!) {
    customers(first: 1, query: $query) { nodes { id } }
  }
`;

export const CREATE_CUSTOMER = `#graphql
  mutation TrekivaCreateCustomer($input: CustomerInput!) {
    customerCreate(input: $input) {
      customer { id }
      userErrors { field message }
    }
  }
`;

export const SET_METAFIELDS = `#graphql
  mutation TrekivaSetClaimMetafields($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id }
      userErrors { field message }
    }
  }
`;

/* eslint-disable @typescript-eslint/no-explicit-any */
async function gql(admin: AdminGraphqlClient, query: string, variables: Record<string, unknown>) {
  const res = await admin.graphql(query, { variables });
  const json = (await res.json()) as { data?: any; errors?: unknown };
  if (json.errors || !json.data) {
    throw new Error(`Shopify GraphQL error: ${JSON.stringify(json.errors ?? "no data")}`);
  }
  return json.data;
}

async function findByEmail(admin: AdminGraphqlClient, email: string): Promise<string | null> {
  // Email is validated upstream; quotes are escaped anyway so it stays one search term.
  const q = `email:"${email.replace(/["\\]/g, "")}"`;
  const data = await gql(admin, FIND_CUSTOMER, { query: q });
  return data.customers.nodes[0]?.id ?? null;
}

export function createCustomerGateway(admin: AdminGraphqlClient): CustomerGateway {
  return {
    async findOrCreate({ email }) {
      const existing = await findByEmail(admin, email);
      if (existing) return existing;

      const data = await gql(admin, CREATE_CUSTOMER, {
        input: {
          email,
          // Only brand-new customers are subscribed; existing customers' consent is never changed.
          emailMarketingConsent: {
            marketingState: "SUBSCRIBED",
            marketingOptInLevel: "SINGLE_OPT_IN",
            consentUpdatedAt: new Date().toISOString(),
          },
          tags: ["trekiva-welcome-popup"],
        },
      });
      const { customer, userErrors } = data.customerCreate;
      if (customer?.id) return customer.id as string;

      // Created concurrently elsewhere (e.g. checkout): look it up again before giving up.
      const retry = await findByEmail(admin, email);
      if (retry) return retry;
      throw new Error(`customerCreate failed: ${JSON.stringify(userErrors)}`);
    },

    /** Mirror only; Postgres stays the source of truth, so failures are logged, not thrown. */
    async writeClaimMetafields({ customerId, discountCode, claimedAt }) {
      try {
        const base = { ownerId: customerId, namespace: "trekiva" };
        const data = await gql(admin, SET_METAFIELDS, {
          metafields: [
            { ...base, key: "welcome_offer_claimed", type: "boolean", value: "true" },
            { ...base, key: "welcome_discount_code", type: "single_line_text_field", value: discountCode },
            { ...base, key: "welcome_offer_claimed_at", type: "date_time", value: claimedAt.toISOString() },
          ],
        });
        const errs = data.metafieldsSet.userErrors;
        if (errs?.length) logger.warn({ errs }, "customer metafields not fully written");
      } catch (err) {
        logger.warn({ err }, "customer metafield mirror failed");
      }
    },
  };
}
