import { Prisma } from "@prisma/client";
import { z } from "zod";
import db from "../db.server";
import { logger } from "../utils/logger.server";
import { generateClaimCode } from "../discounts/redeem-codes.server";
import { defaultCampaign } from "../campaigns/defaults";
import type { CampaignContent, CampaignRules } from "../campaigns/schema";
import { normalizeEmail } from "./email";
import {
  CampaignUnavailableError,
  InvalidEmailError,
  type ClaimContext,
  type ClaimFailureStep,
  type ClaimOutcome,
  type CustomerGateway,
  type DiscountCodeGateway,
  type FlowGateway,
} from "./types";

const emailSchema = z.string().max(254).email();
/** A PENDING claim older than this is treated as a crashed attempt and may be retried. */
const STALE_PENDING_MS = 5 * 60 * 1000;
/** How many fresh suffixes to try before giving up on a unique code. */
const CODE_ATTEMPTS = 5;

/**
 * Which unique index a write violated. The claim row has two, and they mean opposite things:
 * the email one is the expected "already claimed", the code one is a suffix collision to retry.
 */
function uniqueViolation(e: unknown): "email" | "code" | null {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return null;
  // Postgres reports the index name; older/other engines report the field list.
  const target = String(e.meta?.target ?? "");
  if (target.includes("email")) return "email";
  if (target.includes("code")) return "code";
  return null;
}

export class ClaimService {
  constructor(
    private readonly customers: CustomerGateway,
    private readonly flow: FlowGateway,
    private readonly discountCodes: DiscountCodeGateway,
  ) {}

  /**
   * Inserts this email's one claim row, with its own freshly generated code.
   * Returns null when the email already has a claim — the unique index, not a prior read,
   * is what decides that, so concurrent requests can never both win.
   */
  private async insertClaim(input: {
    shopDomain: string;
    campaignId: string;
    emailNormalized: string;
    baseCode: string;
  }) {
    const { baseCode, ...row } = input;
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
      try {
        return await db.welcomeOfferClaim.create({
          data: { ...row, discountCode: generateClaimCode(baseCode) },
        });
      } catch (e) {
        const conflict = uniqueViolation(e);
        if (conflict === "email") return null;
        // A code collision is astronomically unlikely; the index makes it loud, so take a new suffix.
        if (conflict !== "code") throw e;
        logger.warn({ ...row, attempt }, "claim code collided, regenerating");
      }
    }
    throw new Error("could not generate a unique claim code");
  }

  /**
   * The first-purchase gate. Shopify's "Limit to one use per customer" only stops a customer
   * reusing a code; it does NOT mean "first order only", so order history is checked here.
   *
   * It runs before the claim row is inserted, so an ineligible email never consumes a claim
   * or a discount code, and two concurrent submissions both get the same answer. An email
   * that already has a claim skips the check: the offer was won before, and an order placed
   * since must not retroactively revoke it (this also keeps retries working).
   */
  private async blockedByFirstPurchase(
    shopDomain: string,
    campaignId: string,
    emailNormalized: string,
  ): Promise<boolean> {
    const prior = await db.welcomeOfferClaim.findUnique({
      where: {
        shopDomain_campaignId_emailNormalized: { shopDomain, campaignId, emailNormalized },
      },
      select: { id: true },
    });
    if (prior) return false;
    const existing = await this.customers.findExisting({ email: emailNormalized });
    return Boolean(existing?.hasOrders);
  }

  /**
   * Idempotent first-claim flow.
   * The claim row is inserted FIRST; the DB unique constraint
   * (shop_domain, campaign_id, email_normalized) decides the winner, so concurrent
   * requests can never both fulfil. Only the winner touches Shopify / Flow.
   */
  async claim({ shopDomain, campaignId, email }: ClaimContext): Promise<ClaimOutcome> {
    const normalized = normalizeEmail(email);
    if (!emailSchema.safeParse(normalized).success) throw new InvalidEmailError();

    const campaign = await db.campaign.findFirst({
      where: { id: campaignId, shopDomain, status: "ACTIVE" },
    });
    if (!campaign?.discountCode || !campaign.discountId) throw new CampaignUnavailableError();
    const discountId = campaign.discountId;

    // Campaigns saved before a copy field existed fall back to the defaults, so the
    // storefront is never answered with an empty message.
    const content = { ...defaultCampaign.content, ...(campaign.content as object) } as CampaignContent;
    const rules = { ...defaultCampaign.rules, ...(campaign.rules as object) } as CampaignRules;
    const claimed: ClaimOutcome = { status: "claimed", message: content.successMessage };
    const already: ClaimOutcome = { status: "already_claimed", message: content.alreadyClaimedMessage };
    const notEligible: ClaimOutcome = { status: "not_eligible", message: content.notEligibleMessage };

    if (
      rules.firstPurchaseOnly &&
      (await this.blockedByFirstPurchase(shopDomain, campaignId, normalized))
    ) {
      return notEligible;
    }

    let claimId: string;
    let claimedAt: Date;
    let code: string;
    const row = await this.insertClaim({
      shopDomain,
      campaignId,
      emailNormalized: normalized,
      baseCode: campaign.discountCode,
    });
    if (row) {
      claimId = row.id;
      claimedAt = row.claimedAt;
      code = row.discountCode;
    } else {
      // Existing claim: it only gets another fulfilment attempt if a previous attempt
      // failed BEFORE Flow was triggered. The compare-and-set lets exactly one request retry.
      const existing = await db.welcomeOfferClaim.findUnique({
        where: {
          shopDomain_campaignId_emailNormalized: {
            shopDomain,
            campaignId,
            emailNormalized: normalized,
          },
        },
      });
      if (!existing || existing.flowTriggeredAt) return already;

      const lock = await db.welcomeOfferClaim.updateMany({
        where: {
          id: existing.id,
          flowTriggeredAt: null,
          OR: [
            { emailStatus: "FAILED" },
            { emailStatus: "PENDING", updatedAt: { lt: new Date(Date.now() - STALE_PENDING_MS) } },
          ],
        },
        data: { emailStatus: "PENDING" },
      });
      if (lock.count !== 1) return already;
      claimId = existing.id;
      claimedAt = existing.claimedAt;
      // A retry reuses the stored code; issueCode is a no-op if it already reached Shopify.
      code = existing.discountCode;
    }

    let step: ClaimFailureStep = "customer";
    try {
      const customer = await this.customers.findOrCreate({ email: normalized });
      const customerId = customer.id;
      await db.welcomeOfferClaim.update({
        where: { id: claimId },
        data: { shopifyCustomerId: customerId },
      });
      // The code must be redeemable before Flow emails it.
      step = "discount";
      await this.discountCodes.issueCode({ discountId, code });
      step = "flow";
      await this.flow.triggerWelcomeOfferClaimed({
        shopDomain,
        email: normalized,
        campaignName: campaign.name,
        discountCode: code,
        claimedAt,
        customerId,
      });
      // Flow still fires for opted-out customers (the merchant's workflow may use another email
      // action), but Shopify Email will skip them, so the claim records it for the merchant.
      await db.welcomeOfferClaim.update({
        where: { id: claimId },
        data: {
          flowTriggeredAt: new Date(),
          emailStatus: customer.subscribed ? "TRIGGERED" : "NOT_SUBSCRIBED",
          failureStep: null,
          failureReason: null,
        },
      });
      // After Flow: a metafield problem must never affect the claim outcome.
      await this.customers.writeClaimMetafields({
        customerId,
        discountCode: code,
        claimedAt,
      });
    } catch (err) {
      logger.error({ err, claimId, shopDomain, campaignId }, "claim fulfilment failed");
      await db.welcomeOfferClaim
        .updateMany({
          where: { id: claimId, flowTriggeredAt: null },
          data: {
            emailStatus: "FAILED",
            failureStep: step,
            failureReason: (err instanceof Error ? err.message : String(err)).slice(0, 500),
          },
        })
        .catch(() => undefined);
      throw err;
    }

    return claimed;
  }
}
