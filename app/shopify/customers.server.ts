import type { AdminGraphqlClient } from "../discounts/types";
import type {
  CustomerGateway,
  CustomerRecord,
  EmailEligibility,
  ExistingCustomer,
} from "../claims/types";
import { CLAIM_METAFIELDS, METAFIELD_NAMESPACE, TAG_CLAIMED } from "../claims/handoff";
import { gql } from "./graphql.server";

export const FIND_CUSTOMER = `#graphql
  query TrekivaFindCustomer($query: String!) {
    customers(first: 1, query: $query) {
      nodes { id firstName numberOfOrders tags defaultEmailAddress { marketingState } }
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

export const REMOVE_TAGS = `#graphql
  mutation TrekivaRemoveClaimTag($id: ID!, $tags: [String!]!) {
    tagsRemove(id: $id, tags: $tags) {
      node { id }
      userErrors { field message }
    }
  }
`;

export const ADD_TAGS = `#graphql
  mutation TrekivaAddClaimTag($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      node { id }
      userErrors { field message }
    }
  }
`;

interface FoundCustomer {
  id: string;
  firstName?: string | null;
  /** UnsignedInt64, so the Admin API returns it as a string. */
  numberOfOrders: string;
  tags?: string[];
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

/** Shopify's marketing states, collapsed to what matters for delivery. Anything unrecognised is UNKNOWN. */
export function eligibilityFor(state: string | null | undefined): EmailEligibility {
  if (state === "SUBSCRIBED") return "SUBSCRIBED";
  if (state === "NOT_SUBSCRIBED" || state === "UNSUBSCRIBED" || state === "PENDING" || state === "INVALID") {
    return "NOT_SUBSCRIBED";
  }
  return "UNKNOWN";
}

const hasClaimTag = (tags: string[] | undefined) =>
  (tags ?? []).some((t) => t.trim().toLowerCase() === TAG_CLAIMED);

/**
 * Entering an email is not marketing consent. A customer is subscribed only when the popup's
 * explicit checkbox was ticked AND they had not made a choice (NOT_SUBSCRIBED). Everything else,
 * including an unsubscribe, a pending double opt-in and an unknown state, is left exactly as it is.
 */
async function withConsent(
  admin: AdminGraphqlClient,
  c: FoundCustomer,
  marketingConsent: boolean,
): Promise<CustomerRecord> {
  const state = c.defaultEmailAddress?.marketingState;
  const alreadyTagged = hasClaimTag(c.tags);
  if (!(marketingConsent && state === "NOT_SUBSCRIBED")) {
    return { id: c.id, firstName: c.firstName ?? null, emailEligibility: eligibilityFor(state), alreadyTagged };
  }

  const data = await gql(admin, SUBSCRIBE_CUSTOMER, {
    input: { customerId: c.id, emailMarketingConsent: singleOptIn() },
  });
  const errs = data.customerEmailMarketingConsentUpdate.userErrors;
  if (errs?.length) {
    throw new Error(`customerEmailMarketingConsentUpdate failed: ${JSON.stringify(errs)}`);
  }
  return { id: c.id, firstName: c.firstName ?? null, emailEligibility: "SUBSCRIBED", alreadyTagged };
}

/**
 * Marks the customer unsubscribed from email marketing. Used by the unsubscribe link in the welcome
 * email, so Shopify stays the single record of consent.
 */
export async function unsubscribeCustomer(admin: AdminGraphqlClient, customerId: string): Promise<void> {
  const data = await gql(admin, SUBSCRIBE_CUSTOMER, {
    input: {
      customerId,
      emailMarketingConsent: { marketingState: "UNSUBSCRIBED", consentUpdatedAt: new Date().toISOString() },
    },
  });
  const errs = data.customerEmailMarketingConsentUpdate.userErrors;
  if (errs?.length) throw new Error(`customerEmailMarketingConsentUpdate failed: ${JSON.stringify(errs)}`);
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

    async findOrCreate({ email, marketingConsent }) {
      const existing = await findByEmail(admin, email);
      if (existing) return withConsent(admin, existing, marketingConsent);

      const data = await gql(admin, CREATE_CUSTOMER, {
        input: {
          email,
          tags: ["trekiva-welcome-popup"],
          // No consent object means Shopify records NOT_SUBSCRIBED: typing an email is not opt-in.
          ...(marketingConsent ? { emailMarketingConsent: singleOptIn() } : {}),
        },
      });
      const { customer, userErrors } = data.customerCreate;
      if (customer?.id) {
        return {
          id: customer.id as string,
          firstName: null,
          emailEligibility: marketingConsent ? "SUBSCRIBED" : "NOT_SUBSCRIBED",
          alreadyTagged: false,
        };
      }

      // Created concurrently elsewhere (e.g. checkout): look it up again before giving up.
      const retry = await findByEmail(admin, email);
      if (retry) return withConsent(admin, retry, marketingConsent);
      throw new Error(`customerCreate failed: ${JSON.stringify(userErrors)}`);
    },

    /** Flow reads these once the tag lands, so a failure here must stop the claim before the tag. */
    async writeClaimMetafields({ customerId, discountCode, claimedAt, campaignId, claimId }) {
      const values: Record<string, string> = {
        welcome_offer_claimed: "true",
        welcome_discount_code: discountCode,
        welcome_claimed_at: claimedAt.toISOString(),
        welcome_campaign_id: campaignId,
        welcome_claim_id: claimId,
      };
      const data = await gql(admin, SET_METAFIELDS, {
        metafields: CLAIM_METAFIELDS.map((m) => ({
          ownerId: customerId,
          namespace: METAFIELD_NAMESPACE,
          key: m.key,
          type: m.type,
          value: values[m.key],
        })),
      });
      const errs = data.metafieldsSet.userErrors;
      if (errs?.length) throw new Error(`metafieldsSet failed: ${JSON.stringify(errs)}`);
    },

    /**
     * Only ever touches our own tag: tagsAdd keeps every other tag, and a tag already present is a no-op.
     * With `restart` the tag is removed first so the add is a real change that starts Flow again.
     */
    async addClaimTag({ customerId, restart }) {
      if (restart) {
        const removed = await gql(admin, REMOVE_TAGS, { id: customerId, tags: [TAG_CLAIMED] });
        const rerrs = removed.tagsRemove.userErrors;
        if (rerrs?.length) throw new Error(`tagsRemove failed: ${JSON.stringify(rerrs)}`);
      }
      const data = await gql(admin, ADD_TAGS, { id: customerId, tags: [TAG_CLAIMED] });
      const errs = data.tagsAdd.userErrors;
      if (errs?.length) throw new Error(`tagsAdd failed: ${JSON.stringify(errs)}`);
    },
  };
}
