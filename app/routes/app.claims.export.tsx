import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { claimRepository } from "../repositories/claim.repository";
import { csvRow } from "../claims/csv";

// Merchant export; also how customers/data_request can be answered.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(
        enc.encode(
          "﻿" +
            csvRow(["email", "customer_id", "campaign", "discount_code", "claimed_at", "email_status", "email_eligibility"]),
        ),
      );
      for await (const batch of claimRepository.exportBatches(shop)) {
        controller.enqueue(
          enc.encode(
            batch
              .map((c) =>
                csvRow([
                  c.emailNormalized,
                  c.shopifyCustomerId,
                  c.campaign.name,
                  c.discountCode,
                  c.claimedAt.toISOString(),
                  c.emailStatus,
                  c.emailEligibility,
                ]),
              )
              .join(""),
          ),
        );
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="trekiva-claims.csv"',
      "Cache-Control": "no-store",
    },
  });
};
