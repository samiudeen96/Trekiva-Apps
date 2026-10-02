import type { AdminGraphqlClient } from "../discounts/types";
import type { FlowGateway } from "../claims/types";

export const FLOW_TRIGGER_HANDLE = "welcome-offer-claimed";

export const FLOW_TRIGGER_RECEIVE = `#graphql
  mutation TrekivaFlowTrigger($handle: String!, $payload: JSON!) {
    flowTriggerReceive(handle: $handle, payload: $payload) {
      userErrors { field message }
    }
  }
`;

/** "gid://shopify/Customer/123" -> 123 (Flow reference fields take the numeric ID). */
export function numericId(gid: string): number {
  const n = Number(gid.split("/").pop());
  if (!Number.isSafeInteger(n)) throw new Error(`Invalid Shopify GID: ${gid}`);
  return n;
}

/**
 * Fires the "Welcome Offer Claimed" trigger. Called ONLY by the request that won
 * the first-claim insert; throws on any failure so the claim is marked FAILED.
 * Payload keys must match extensions/welcome-offer-flow-trigger/shopify.extension.toml.
 */
export function createFlowGateway(admin: AdminGraphqlClient): FlowGateway {
  return {
    async triggerWelcomeOfferClaimed(input) {
      const res = await admin.graphql(FLOW_TRIGGER_RECEIVE, {
        variables: {
          handle: FLOW_TRIGGER_HANDLE,
          payload: {
            customer_id: numericId(input.customerId),
            CustomerEmail: input.email,
            CampaignName: input.campaignName,
            DiscountCode: input.discountCode,
            ClaimedAt: input.claimedAt.toISOString(),
          },
        },
      });
      const json = (await res.json()) as {
        data?: { flowTriggerReceive?: { userErrors: unknown[] } };
        errors?: unknown;
      };
      const userErrors = json.data?.flowTriggerReceive?.userErrors;
      if (json.errors || !userErrors || userErrors.length > 0) {
        throw new Error(
          `flowTriggerReceive failed: ${JSON.stringify(json.errors ?? userErrors ?? "no data")}`,
        );
      }
    },
  };
}
