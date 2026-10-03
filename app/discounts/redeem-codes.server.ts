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
      if (found.codeDiscountNodeByCode) return;

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
