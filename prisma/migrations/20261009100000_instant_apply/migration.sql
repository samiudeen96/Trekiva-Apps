-- Instant apply: a claim whose discount is applied in the browser at signup, with no email.
ALTER TYPE "EmailStatus" ADD VALUE IF NOT EXISTS 'APPLIED';
ALTER TYPE "EmailDelivery" ADD VALUE IF NOT EXISTS 'INSTANT';
