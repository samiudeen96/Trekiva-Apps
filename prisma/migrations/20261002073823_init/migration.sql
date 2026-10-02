-- CreateEnum
CREATE TYPE "CampaignType" AS ENUM ('WELCOME_DISCOUNT');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "PopupTemplate" AS ENUM ('SPLIT_IMAGE', 'CENTERED_MINIMAL', 'IMAGE_BANNER');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('PENDING', 'TRIGGERED', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "shop_domain" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CampaignType" NOT NULL DEFAULT 'WELCOME_DISCOUNT',
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "template" "PopupTemplate" NOT NULL DEFAULT 'SPLIT_IMAGE',
    "discount_id" TEXT,
    "discount_code" TEXT,
    "discount_title" TEXT,
    "content" JSONB NOT NULL,
    "design" JSONB NOT NULL,
    "rules" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "welcome_offer_claims" (
    "id" TEXT NOT NULL,
    "shop_domain" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "shopify_customer_id" TEXT,
    "email_normalized" TEXT NOT NULL,
    "discount_code" TEXT NOT NULL,
    "claimed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "flow_triggered_at" TIMESTAMP(3),
    "email_sent_at" TIMESTAMP(3),
    "email_status" "EmailStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "welcome_offer_claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Session_shop_idx" ON "Session"("shop");

-- CreateIndex
CREATE INDEX "campaigns_shop_domain_status_idx" ON "campaigns"("shop_domain", "status");

-- CreateIndex
CREATE INDEX "welcome_offer_claims_shop_domain_claimed_at_idx" ON "welcome_offer_claims"("shop_domain", "claimed_at");

-- CreateIndex
CREATE INDEX "welcome_offer_claims_campaign_id_idx" ON "welcome_offer_claims"("campaign_id");

-- CreateIndex
CREATE UNIQUE INDEX "welcome_offer_claims_unique_email_per_campaign" ON "welcome_offer_claims"("shop_domain", "campaign_id", "email_normalized");

-- AddForeignKey
ALTER TABLE "welcome_offer_claims" ADD CONSTRAINT "welcome_offer_claims_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
