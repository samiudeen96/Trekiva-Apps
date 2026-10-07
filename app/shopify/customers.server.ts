import type { AdminGraphqlClient } from "../discounts/types";
import type { CustomerGateway, CustomerRecord, ExistingCustomer } from "../claims/types";
import { logger } from "../utils/logger.server";
import { gql } from "./graphql.server";

export const FIND_CUSTOMER = `#graphql
  query TrekivaFindCustomer($query: String!) {
    customers(first: 1, query: $query) {
      nodes { id numberOfOrders defaultEmailAddress { marketingState } }
    }
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

export const SUBSCRIBE_CUSTOMER = `#graphql
  mutation TrekivaSubscribeCustomer($input: CustomerEmailMarketingConsentUpdateInput!) {
    customerEmailMarketingConsentUpdate(input: $input) {
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

interface FoundCustomer {
  id: string;
  /** UnsignedInt64, so the Admin API returns it as a string. */
  numberOfOrders: string;
  defaultEmailAddress: { marketingState: string } | null;
}

const singleOptIn = () => ({
  marketingState: "SUBSCRIBED",
  marketingOptInLevel: "SINGLE_OPT_IN",
  consentUpdatedAt: new Date().toISOString(),
});

async function findByEmail(admin: AdminGraphqlClient, email: string): Promise<FoundCustomer | null> {
  // Email is validated upstream; quotes are escaped anyway so it stays one search term.
  const q = `email:"${email.replace(/["\\]/g, "")}"`;
  const data = await gql(admin, FIND_CUSTOMER, { query: q });
  return data.customers.nodes[0] ?? null;
}

/**
 * Submitting the popup is the opt-in, but only for customers who never chose.
 * An explicit unsubscribe, a pending double opt-in or an invalid address is never overridden.
 */
async function withConsent(admin: AdminGraphqlClient, c: FoundCustomer): Promise<CustomerRecord> {
  const state = c.defaultEmailAddress?.marketingState;
  if (state === "SUBSCRIBED") return { id: c.id, subscribed: true };
  if (state !== "NOT_SUBSCRIBED") return { id: c.id, subscribed: false };

  const data = await gql(admin, SUBSCRIBE_CUSTOMER, {
    input: { customerId: c.id, emailMarketingConsent: singleOptIn() },
  });
  const errs = data.customerEmailMarketingConsentUpdate.userErrors;
  if (errs?.length) {
    throw new Error(`customerEmailMarketingConsentUpdate failed: ${JSON.stringify(errs)}`);
  }
  return { id: c.id, subscribed: true };
}

export function createCustomerGateway(admin: AdminGraphqlClient): CustomerGateway {
  return {
    async findExisting({ email }): Promise<ExistingCustomer | null> {
      const found = await findByEmail(admin, email);
      if (!found) return null;
      // Anything unparseable is treated as "has ordered" so a bad read can never hand a
      // first-purchase-only offer to a returning customer.
      const orders = Number(found.numberOfOrders);
      return { id: found.id, hasOrders: !Number.isFinite(orders) || orders > 0 };
    },

    async findOrCreate({ email }) {
      const existing = await findByEmail(admin, email);
      if (existing) return withConsent(admin, existing);

      const data = await gql(admin, CREATE_CUSTOMER, {
        input: { email, emailMarketingConsent: singleOptIn(), tags: ["trekiva-welcome-popup"] },
      });
      const { customer, userErrors } = data.customerCreate;
      if (customer?.id) return { id: customer.id as string, subscribed: true };

      // Created concurrently elsewhere (e.g. checkout): look it up again before giving up.
      const retry = await findByEmail(admin, email);
      if (retry) return withConsent(admin, retry);
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
