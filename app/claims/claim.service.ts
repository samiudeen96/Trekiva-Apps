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
  type EmailGateway,
} from "./types";
import { resolveEmailTemplate } from "../email/defaults";

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
    private readonly discountCodes: DiscountCodeGateway,
    /** Absent when Resend is not configured: Shopify Flow then delivers, exactly as before. */
    private readonly email?: EmailGateway,
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
    marketingConsent: boolean;
    delivery: "FLOW" | "APP" | "INSTANT";
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
   * requests can never both fulfil. Only the winner touches Shopify.
   *
   * Fulfilment order is fixed, because Shopify Flow starts the moment the tag lands and must
   * then find everything it reads:
   *   customer -> discount code -> metafields -> tag (LAST)
   * Every step is idempotent, so a retry simply runs them again with the stored code.
   */
  async claim({ shopDomain, campaignId, email, marketingConsent = false }: ClaimContext): Promise<ClaimOutcome> {
    const normalized = normalizeEmail(email);
    if (!emailSchema.safeParse(normalized).success) throw new InvalidEmailError();

    const campaign = await db.campaign.findFirst({
      where: { id: campaignId, shopDomain, status: "ACTIVE" },
      // The email it sends. Read at send time, so template edits apply to every later claim.
      include: { emailTemplate: { select: { template: true } } },
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
    // The popup applies the discount only when the merchant turned instant apply on. `emailed` picks the wording
    // that tells the customer a copy is also on its way. Never used for "already claimed".
    const appliedOutcome = (code: string, emailed: boolean): ClaimOutcome => ({
      status: "claimed",
      message: emailed ? content.appliedEmailedMessage : content.appliedMessage,
      title: content.appliedTitle,
      applyPath: `/discount/${encodeURIComponent(code)}`,
    });

    if (
      rules.firstPurchaseOnly &&
      (await this.blockedByFirstPurchase(shopDomain, campaignId, normalized))
    ) {
      return notEligible;
    }

    // Who delivers this claim is fixed when it is created, so changing the configuration later can
    // never email an already-handled claim a second time.
    // "Email the code" asks for an email; with instant apply but no way to send one (no Resend key), the
    // claim is simply instant. With instant apply off the original email/Flow paths run as before.
    const emailWanted = rules.emailCode;
    const delivery: "FLOW" | "APP" | "INSTANT" =
      rules.applyOnSignup && !(emailWanted && this.email) ? "INSTANT" : this.email ? "APP" : "FLOW";

    let claimId: string;
    let claimedAt: Date;
    let code: string;
    let consent: boolean;
    let firstAttempt: boolean;
    let mode: "FLOW" | "APP" | "INSTANT";
    const row = await this.insertClaim({
      shopDomain,
      campaignId,
      emailNormalized: normalized,
      marketingConsent,
      delivery,
      baseCode: campaign.discountCode,
    });
    if (row) {
      claimId = row.id;
      claimedAt = row.claimedAt;
      code = row.discountCode;
      consent = row.marketingConsent;
      firstAttempt = true;
      mode = row.delivery;
    } else {
      // Existing claim: it only gets another fulfilment attempt if a previous attempt did not finish.
      // "Finished" depends on who delivers it: the Flow tag for FLOW claims, the sent email for APP
      // claims. The compare-and-set lets exactly one request retry.
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
      if (existing.delivery === "INSTANT" ? existing.emailStatus === "APPLIED" : existing.delivery === "APP" ? existing.emailSentAt : existing.flowHandoffAt) {
        return already;
      }
      const unsettled =
        existing.delivery === "INSTANT" ? {} : existing.delivery === "APP" ? { emailSentAt: null } : { flowHandoffAt: null };

      const lock = await db.welcomeOfferClaim.updateMany({
        where: {
          id: existing.id,
          ...unsettled,
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
      // A retry reuses the stored code and the consent given at the original submission.
      code = existing.discountCode;
      consent = existing.marketingConsent;
      firstAttempt = false;
      mode = existing.delivery;
    }

    let step: ClaimFailureStep = "customer";
    try {
      const customer = await this.customers.findOrCreate({ email: normalized, marketingConsent: consent });
      await db.welcomeOfferClaim.update({
        where: { id: claimId },
        data: { shopifyCustomerId: customer.id, emailEligibility: customer.emailEligibility },
      });
      // The code must be redeemable before the customer can be told about it.
      step = "discount";
      await this.discountCodes.issueCode({ discountId, code });

      if (mode === "INSTANT") {
        // No email, metafields or Flow tag: the customer already has the code (redeemable above) and the
        // popup applies it in their browser. The customer record exists so signing up still subscribes them.
        await db.welcomeOfferClaim.update({
          where: { id: claimId },
          data: { emailStatus: "APPLIED", failureStep: null, failureReason: null },
        });
        return appliedOutcome(code, false);
      }

      if (mode === "APP") {
        // The app sends the email, so Flow has nothing to do: no tag (a workflow left switched on
        // could otherwise send a second email). Metafields are only mirrored, after the send.
        step = "email";
        if (!this.email) throw new Error("Email sending is not configured (RESEND_API_KEY / EMAIL_FROM)");
        await this.email.sendWelcomeOffer({
          claimId,
          shopDomain,
          email: normalized,
          customerId: customer.id,
          firstName: customer.firstName ?? null,
          discountCode: code,
          emailEligibility: customer.emailEligibility,
          template: resolveEmailTemplate(campaign.emailTemplate?.template),
        });
        await db.welcomeOfferClaim.update({
          where: { id: claimId },
          data: { emailSentAt: new Date(), emailStatus: "EMAIL_SENT", failureStep: null, failureReason: null },
        });
        try {
          await this.customers.writeClaimMetafields({
            customerId: customer.id,
            discountCode: code,
            claimedAt,
            campaignId,
            claimId,
          });
        } catch (err) {
          logger.warn({ err, claimId }, "email sent, but the customer metafields could not be mirrored");
        }
        return rules.applyOnSignup ? appliedOutcome(code, true) : claimed;
      }

      step = "metafields";
      await this.customers.writeClaimMetafields({
        customerId: customer.id,
        discountCode: code,
        claimedAt,
        campaignId,
        claimId,
      });
      // Flow starts when this tag is ADDED, so it goes last. A brand new claim for a customer who still has the
      // tag (their earlier claim was deleted, or another campaign) must re-add it or Flow never fires. A retry must
      // NOT: its tag may be ours from an attempt whose response was lost, and Flow has already started for it.
      step = "tag";
      const restart = firstAttempt && customer.alreadyTagged;
      if (restart) logger.info({ claimId, shopDomain, campaignId }, "customer already had the claim tag: re-adding it to start Flow");
      await this.customers.addClaimTag({ customerId: customer.id, restart });
      await db.welcomeOfferClaim.update({
        where: { id: claimId },
        data: {
          flowHandoffAt: new Date(),
          emailStatus: "READY_FOR_FLOW",
          failureStep: null,
          failureReason: null,
        },
      });
    } catch (err) {
      logger.error({ err, claimId, shopDomain, campaignId, step }, "claim fulfilment failed");
      await db.welcomeOfferClaim
        .updateMany({
          where: {
            id: claimId,
            ...(mode === "INSTANT" ? { emailStatus: { not: "APPLIED" as const } } : mode === "APP" ? { emailSentAt: null } : { flowHandoffAt: null }),
          },
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
