-- Email templates become shop-level and reusable: edited under "Email templates", picked by campaigns.
-- Additive: campaigns.email stays (now unused) so nothing is lost.

CREATE TABLE "email_templates" (
  "id" TEXT NOT NULL,
  "shop_domain" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "template" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "email_templates_shop_domain_idx" ON "email_templates"("shop_domain");

ALTER TABLE "campaigns" ADD COLUMN "email_template_id" TEXT;
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_email_template_id_fkey"
  FOREIGN KEY ("email_template_id") REFERENCES "email_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A campaign that already has its own email keeps it: it becomes a named template the campaign points at.
INSERT INTO "email_templates" ("id", "shop_domain", "name", "template", "created_at", "updated_at")
SELECT 'tpl_' || "id", "shop_domain", "name" || ' email', "email", now(), now()
FROM "campaigns" WHERE "email" <> '{}'::jsonb;

UPDATE "campaigns" SET "email_template_id" = 'tpl_' || "id" WHERE "email" <> '{}'::jsonb;
