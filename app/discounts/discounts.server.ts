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
      codes(first: 1) { nodes { code } }
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
      context { __typename }
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

  const warnings: string[] = [];
  if (!d.appliesOncePerCustomer)
    warnings.push("Not limited to one use per customer. Enable it on this discount in Shopify.");
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
    eligibility: ELIGIBILITY[d.context?.__typename] ?? "All customers",
    warnings,
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
