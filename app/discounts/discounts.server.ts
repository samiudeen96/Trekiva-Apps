import { logger } from "../utils/logger.server";
import type { AdminGraphqlClient, DiscountSummary } from "./types";

const DISCOUNT_FIELDS = `#graphql
  id
  discount {
    __typename
    ... on DiscountCodeBasic {
      title
      status
      startsAt
      endsAt
      appliesOncePerCustomer
      usageLimit
      # Oldest code = the merchant's base code, not one of the per-claim codes added later.
      codes(first: 1, sortKey: CREATED_AT) { nodes { code } }
      customerGets {
        value {
          __typename
          ... on DiscountPercentage { percentage }
          ... on DiscountAmount { amount { amount currencyCode } }
        }
      }
      minimumRequirement {
        __typename
        ... on DiscountMinimumSubtotal {
          greaterThanOrEqualToSubtotal { amount currencyCode }
        }
        ... on DiscountMinimumQuantity { greaterThanOrEqualToQuantity }
      }
      context {
        __typename
        ... on DiscountCustomerSegments {
          segments { id name }
        }
      }
    }
  }
`;

const LIST_QUERY = `#graphql
  query TrekivaCodeDiscounts {
    discountNodes(first: 100, query: "method:code", sortKey: CREATED_AT, reverse: true) {
      nodes { ${DISCOUNT_FIELDS} }
    }
  }
`;

const GET_QUERY = `#graphql
  query TrekivaCodeDiscount($id: ID!) {
    discountNode(id: $id) { ${DISCOUNT_FIELDS} }
  }
`;

/* eslint-disable @typescript-eslint/no-explicit-any */
const money = (m: any) => `${m.amount} ${m.currencyCode}`;

const ELIGIBILITY: Record<string, string> = {
  DiscountBuyerSelectionAll: "All customers",
  DiscountCustomers: "Specific customers",
  DiscountCustomerSegments: "Customer segments",
  DiscountMarkets: "Specific markets",
  DiscountContextUnknown: "Unknown (not supported by this API version)",
};

/** Maps a discountNode to a summary; null for non-basic (unsupported) discounts. */
export function toDiscountSummary(node: any): DiscountSummary | null {
  const d = node?.discount;
  if (!d || d.__typename !== "DiscountCodeBasic") return null;
  const code: string | undefined = d.codes?.nodes?.[0]?.code;
  if (!code) return null;

  const value = d.customerGets?.value;
  const isPercentage = value?.__typename === "DiscountPercentage";
  const valueLabel = isPercentage
    ? `${Math.round(value.percentage * 1000) / 10}% off`
    : value?.__typename === "DiscountAmount"
      ? `${money(value.amount)} off`
      : "Custom value";

  const min = d.minimumRequirement;
  const minimumRequirement =
    min?.__typename === "DiscountMinimumSubtotal"
      ? `Min. spend ${money(min.greaterThanOrEqualToSubtotal)}`
      : min?.__typename === "DiscountMinimumQuantity"
        ? `Min. ${min.greaterThanOrEqualToQuantity} items`
        : "None";

  const eligibility = ELIGIBILITY[d.context?.__typename] ?? "All customers";
  const segmentNames: string[] = (d.context?.segments ?? []).map((seg: any) => seg.name).filter(Boolean);
  const warnings: string[] = [];
  const notes: string[] = [];
  // Shopify applies usageLimit to EACH redeem code, not across the discount (confirmed by
  // Shopify staff), so 1 makes every per-claim code single-use while the number of claims
  // stays unlimited. A recommendation, not a requirement: the app issues one code per email
  // either way, but without it a forwarded code keeps working for everyone who receives it.
  if (d.usageLimit !== 1)
    notes.push(
      "Recommended: tick \"Limit number of times each code can be used in total\" and set it to 1. As that label says, Shopify applies the limit to each code separately, so it caps each claim's own code at one redemption and never caps your campaign - the app adds a new code for every claim, so claims stay unlimited. Left unticked, a code still works after it has been redeemed, so one forwarded code can be used by any number of customers.",
    );
  // The app issues one code per email, so this is what stops that customer reusing their own code.
  if (!d.appliesOncePerCustomer)
    warnings.push(
      "Turn on \"Limit to one use per customer\" on this discount so a customer cannot redeem their welcome code more than once.",
    );
  if (d.context?.__typename === "DiscountCustomers")
    warnings.push(
      "This discount is limited to specific customers, so new sign-ups cannot use it. Set eligibility to All customers.",
    );
  // A segment such as "Customers who haven't purchased" is the right way to restrict a welcome
  // offer, so this is information, not a problem. The catch worth stating: Shopify only applies
  // it at checkout, so an ineligible customer can still claim a code and be refused later.
  if (d.context?.__typename === "DiscountCustomerSegments")
    notes.push(
      `Eligibility is limited to the customer segment${segmentNames.length === 1 ? "" : "s"} ${
        segmentNames.length ? segmentNames.map((n) => `"${n}"`).join(", ") : "selected on this discount"
      }. Shopify only checks this at checkout, so a customer outside the segment can still claim a code here and is refused only when they try to use it. Turn on "First-time customers only" in Display rules to refuse them up front instead.`,
    );
  if (!isPercentage)
    warnings.push("This is not a percentage discount; copy that mentions a percentage may be wrong.");
  if (d.status === "EXPIRED") warnings.push("This discount has expired.");
  if (d.status === "SCHEDULED") warnings.push("This discount is scheduled and not active yet.");

  return {
    id: node.id,
    code,
    title: d.title,
    valueLabel,
    isPercentage,
    status: d.status,
    startsAt: d.startsAt ?? null,
    endsAt: d.endsAt ?? null,
    oncePerCustomer: Boolean(d.appliesOncePerCustomer),
    minimumRequirement,
    usageLimit: d.usageLimit ?? null,
    eligibility,
    segmentNames,
    warnings,
    notes,
  };
}

async function run(admin: AdminGraphqlClient, query: string, variables?: Record<string, unknown>) {
  const res = await admin.graphql(query, variables ? { variables } : undefined);
  const json = (await res.json()) as { data?: any; errors?: unknown };
  if (json.errors) {
    logger.error({ errors: json.errors }, "discount query failed");
    throw new Error("Shopify discount query failed");
  }
  return json.data;
}

export async function listCodeDiscounts(admin: AdminGraphqlClient): Promise<DiscountSummary[]> {
  const data = await run(admin, LIST_QUERY);
  return (data.discountNodes.nodes as any[])
    .map(toDiscountSummary)
    .filter((d): d is DiscountSummary => d !== null);
}

export async function getCodeDiscount(
  admin: AdminGraphqlClient,
  id: string,
): Promise<DiscountSummary | null> {
  const data = await run(admin, GET_QUERY, { id });
  return data.discountNode ? toDiscountSummary(data.discountNode) : null;
}
