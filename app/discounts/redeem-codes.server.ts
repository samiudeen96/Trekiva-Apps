import { randomInt } from "node:crypto";
import type { DiscountCodeGateway } from "../claims/types";
import { gql } from "../shopify/graphql.server";
import { claimCodePrefix } from "./claim-code";
import type { AdminGraphqlClient } from "./types";

export const FIND_CODE = `#graphql
  query TrekivaFindRedeemCode($code: String!) {
    codeDiscountNodeByCode(code: $code) { id }
  }
`;

export const ADD_CODE = `#graphql
  mutation TrekivaAddRedeemCode($discountId: ID!, $codes: [DiscountRedeemCodeInput!]!) {
    discountRedeemCodeBulkAdd(discountId: $discountId, codes: $codes) {
      bulkCreation { id }
      userErrors { field message }
    }
  }
`;

export const BULK_STATUS = `#graphql
  query TrekivaRedeemCodeBulkStatus($id: ID!) {
    discountRedeemCodeBulkCreation(id: $id) {
      done
      importedCount
      codes(first: 1) { nodes { errors { message } } }
    }
  }
`;

// No 0/O/1/I/L: codes are often retyped from an email on a phone.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** "Welcome10" -> "WELCOME10-7KQ2M9XH". The random suffix makes each claim's code unguessable. */
export function generateClaimCode(baseCode: string): string {
  let suffix = "";
  for (let i = 0; i < 8; i++) suffix += ALPHABET[randomInt(ALPHABET.length)];
  return `${claimCodePrefix(baseCode)}-${suffix}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Adds a claim's own code to the campaign's Shopify discount, so it inherits that
 * discount's value, minimums, dates and usage limit (Shopify applies usageLimit per code).
 */
export function createDiscountCodeGateway(
  admin: AdminGraphqlClient,
  { pollMs = 300, maxPolls = 20 } = {},
): DiscountCodeGateway {
  return {
    async issueCode({ discountId, code }) {
      // Idempotent: a retried claim may already have added its code on an earlier attempt.
      const found = await gql(admin, FIND_CODE, { code });
      const owner = found.codeDiscountNodeByCode;
      if (owner) {
        if (owner.id === discountId) return;
        // The code exists on a different discount, so it would hand the customer the wrong
        // offer (or one already spent). Fail loudly rather than email an unverified code.
        throw new Error(`claim code already belongs to another discount: ${owner.id}`);
      }

      const added = await gql(admin, ADD_CODE, { discountId, codes: [{ code }] });
      const { bulkCreation, userErrors } = added.discountRedeemCodeBulkAdd;
      if (userErrors?.length || !bulkCreation) {
        throw new Error(`discountRedeemCodeBulkAdd failed: ${JSON.stringify(userErrors)}`);
      }

      // The add runs as a background job; the code must be redeemable before it is emailed.
      for (let i = 0; i < maxPolls; i++) {
        await sleep(pollMs);
        const status = (await gql(admin, BULK_STATUS, { id: bulkCreation.id }))
          .discountRedeemCodeBulkCreation;
        if (!status?.done) continue;
        if (status.importedCount === 1) return;
        throw new Error(`discount code not created: ${JSON.stringify(status.codes.nodes[0]?.errors ?? [])}`);
      }
      throw new Error("discount code creation did not finish in time");
    },
  };
}

export const FIND_REDEEM_CODE = `#graphql
  query TrekivaRedeemCodeId($code: String!) {
    codeDiscountNodeByCode(code: $code) {
      id
      codeDiscount {
        ... on DiscountCodeBasic { codes(first: 25, query: $code) { nodes { id code asyncUsageCount } } }
        ... on DiscountCodeBxgy { codes(first: 25, query: $code) { nodes { id code asyncUsageCount } } }
        ... on DiscountCodeFreeShipping { codes(first: 25, query: $code) { nodes { id code asyncUsageCount } } }
      }
    }
  }
`;

export const DELETE_CODES = `#graphql
  mutation TrekivaDeleteRedeemCodes($discountId: ID!, $ids: [ID!]) {
    discountCodeRedeemCodeBulkDelete(discountId: $discountId, ids: $ids) {
      job { id }
      userErrors { field message }
    }
  }
`;

export type RevokeResult = "revoked" | "not-found" | "other-discount";

/**
 * Removes one claim's code from its discount, so a code an order already spent cannot buy another.
 *
 * Shopify counts a redemption only when its own checkout redeems the code; a checkout app that
 * applies the amount itself leaves the code unused and endlessly reusable. Deleting the code is
 * the only lever Shopify offers, as a single redeem code cannot be disabled.
 *
 * It refuses to touch a code that belongs to a different discount, so a merchant's own codes and
 * other apps' codes are never at risk. `discountId` must come from the claim's own campaign.
 */
export async function revokeClaimCode(
  admin: AdminGraphqlClient,
  { discountId, code }: { discountId: string; code: string },
): Promise<RevokeResult> {
  const node = (await gql(admin, FIND_REDEEM_CODE, { code })).codeDiscountNodeByCode;
  // Already gone (a repeated webhook, or the merchant deleted it): nothing to do.
  if (!node) return "not-found";
  if (node.id !== discountId) return "other-discount";

  // `query` is a search, so the exact code is matched here rather than trusting the result order.
  const match = (node.codeDiscount?.codes?.nodes ?? []).find(
    (n: { code?: string }) => n.code?.toUpperCase() === code.toUpperCase(),
  );
  if (!match) return "not-found";

  const res = await gql(admin, DELETE_CODES, { discountId, ids: [match.id] });
  const errors = res.discountCodeRedeemCodeBulkDelete?.userErrors;
  if (errors?.length) throw new Error(`could not delete redeem code: ${JSON.stringify(errors)}`);
  return "revoked";
}
