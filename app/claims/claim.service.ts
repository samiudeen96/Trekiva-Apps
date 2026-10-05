import { Prisma } from "@prisma/client";
import { z } from "zod";
import db from "../db.server";
import { logger } from "../utils/logger.server";
import { defaultCampaign } from "../campaigns/defaults";
import { generateClaimCode } from "../discounts/redeem-codes.server";
import { normalizeEmail } from "./email";
import {
  CampaignUnavailableError,
  InvalidEmailError,
  type ClaimContext,
  type ClaimOutcome,
  type CustomerGateway,
  type DiscountCodeGateway,
  type EmailGateway,
} from "./types";

const emailSchema = z.string().max(254).email();
/** A PENDING claim older than this is treated as a crashed attempt and may be retried. */
const STALE_PENDING_MS = 5 * 60 * 1000;

export class ClaimService {
  constructor(
    private readonly customers: CustomerGateway,
    private readonly email: EmailGateway,
    private readonly discountCodes: DiscountCodeGateway,
  ) {}

  /**
   * Idempotent first-claim flow.
   * The claim row is inserted FIRST; the DB unique constraint
   * (shop_domain, campaign_id, email_normalized) decides the winner, so concurrent
   * requests can never both fulfil. Only the winner touches Shopify / the email provider.
   */
  async claim({ shopDomain, campaignId, email }: ClaimContext): Promise<ClaimOutcome> {
    const normalized = normalizeEmail(email);
    if (!emailSchema.safeParse(normalized).success) throw new InvalidEmailError();

    const campaign = await db.campaign.findFirst({
      where: { id: campaignId, shopDomain, status: "ACTIVE" },
    });
    if (!campaign?.discountCode || !campaign.discountId) throw new CampaignUnavailableError();
    const discountId = campaign.discountId;

    // Campaigns saved before the email fields existed fall back to the defaults.
    const content = { ...defaultCampaign.content, ...(campaign.content as object) };
    const claimed: ClaimOutcome = { status: "claimed", message: content.successMessage };
    const already: ClaimOutcome = { status: "already_claimed", message: content.alreadyClaimedMessage };

    let claimId: string;
    let claimedAt: Date;
    let code: string;
    try {
      const row = await db.welcomeOfferClaim.create({
        data: {
          shopDomain,
          campaignId,
          emailNormalized: normalized,
          discountCode: generateClaimCode(campaign.discountCode),
        },
      });
      claimId = row.id;
      claimedAt = row.claimedAt;
      code = row.discountCode;
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;

      // Existing claim: it only gets another fulfilment attempt if a previous attempt
      // failed BEFORE the email went out. The compare-and-set lets exactly one request retry.
      const existing = await db.welcomeOfferClaim.findUnique({
        where: {
          shopDomain_campaignId_emailNormalized: {
            shopDomain,
            campaignId,
            emailNormalized: normalized,
          },
        },
      });
      if (!existing || existing.emailSentAt) return already;

      const lock = await db.welcomeOfferClaim.updateMany({
        where: {
          id: existing.id,
          emailSentAt: null,
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

    try {
      const customer = await this.customers.findOrCreate({ email: normalized });
      const customerId = customer.id;
      await db.welcomeOfferClaim.update({
        where: { id: claimId },
        data: { shopifyCustomerId: customerId },
      });
      // The code must be redeemable before the customer receives it.
      await this.discountCodes.issueCode({ discountId, code });
      // This is marketing email, so an opted-out customer is never sent to. The claim still
      // counts; it is recorded as NOT_SUBSCRIBED so the merchant can follow up another way.
      if (customer.subscribed) {
        await this.email.sendWelcomeOffer({
          claimId,
          shopDomain,
          email: normalized,
          campaignName: campaign.name,
          discountCode: code,
          claimedAt,
          customerId,
          emailContent: {
            subject: content.emailSubject,
            heading: content.emailHeading,
            body: content.emailBody,
          },
        });
        await db.welcomeOfferClaim.update({
          where: { id: claimId },
          data: { emailSentAt: new Date(), emailStatus: "SENT" },
        });
      } else {
        await db.welcomeOfferClaim.update({
          where: { id: claimId },
          data: { emailStatus: "NOT_SUBSCRIBED" },
        });
      }
      // After delivery: a metafield problem must never affect the claim outcome.
      await this.customers.writeClaimMetafields({
        customerId,
        discountCode: code,
        claimedAt,
      });
    } catch (err) {
      logger.error({ err, claimId, shopDomain, campaignId }, "claim fulfilment failed");
      await db.welcomeOfferClaim
        .updateMany({
          where: { id: claimId, emailSentAt: null, emailStatus: "PENDING" },
          data: { emailStatus: "FAILED" },
        })
        .catch(() => undefined);
      throw err;
    }

    return claimed;
  }
}
