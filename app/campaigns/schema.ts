import { z } from "zod";

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex color");
const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max);

export const contentSchema = z.object({
  title: text(120),
  description: optionalText(400),
  emailPlaceholder: text(60),
  buttonText: text(40),
  consentLabel: text(120),
  successTitle: text(120),
  successMessage: text(400),
  alreadyClaimedTitle: text(120),
  alreadyClaimedMessage: text(400),
  notEligibleTitle: text(120),
  notEligibleMessage: text(400),
  privacyText: optionalText(300),
});

export const designSchema = z.object({
  backgroundColor: hexColor,
  textColor: hexColor,
  buttonBackground: hexColor,
  buttonTextColor: hexColor,
  borderRadius: z.coerce.number().int().min(0).max(40),
  overlayOpacity: z.coerce.number().int().min(0).max(100),
  popupWidth: z.coerce.number().int().min(320).max(900),
  // https only: this URL is rendered on the storefront.
  imageUrl: z
    .string()
    .trim()
    .max(2048)
    .refine((v) => v === "" || /^https:\/\//i.test(v), "Image must be an https URL"),
  imagePosition: z.enum(["left", "right", "top"]),
  showCloseIcon: z.boolean(),
  alignment: z.enum(["left", "center", "right"]),
});

export const rulesSchema = z.object({
  trigger: z.enum(["delay", "load", "exit_intent", "manual"]),
  delaySeconds: z.coerce.number().int().min(0).max(300),
  pages: z.enum(["all", "home", "product", "collection", "specific"]),
  specificUrls: z.array(z.string().trim().min(1).max(300)).max(20),
  devices: z.enum(["all", "desktop", "mobile"]),
  frequency: z.enum(["session", "visitor", "days"]),
  frequencyDays: z.coerce.number().int().min(1).max(365),
  /**
   * Restricts the offer to customers who have never completed an order. Shopify's
   * "Limit to one use per customer" does NOT mean "first order only", so this is the
   * only thing that keeps returning customers out.
   */
  firstPurchaseOnly: z.boolean(),
});

export const detailsSchema = z.object({
  name: text(80),
  status: z.enum(["DRAFT", "ACTIVE", "DISABLED"]),
  template: z.enum(["SPLIT_IMAGE", "CENTERED_MINIMAL", "IMAGE_BANNER"]),
});

export type CampaignContent = z.infer<typeof contentSchema>;
export type CampaignDesign = z.infer<typeof designSchema>;
export type CampaignRules = z.infer<typeof rulesSchema>;
export type CampaignDetails = z.infer<typeof detailsSchema>;

export const discountIdSchema = z
  .string()
  .regex(/^gid:\/\/shopify\/DiscountCodeNode\/\d+$/)
  .nullable();

export interface CampaignInput {
  /** Existing Shopify native discount (DiscountCodeNode GID). */
  discountId: string | null;
  details: CampaignDetails;
  content: CampaignContent;
  design: CampaignDesign;
  rules: CampaignRules;
}
