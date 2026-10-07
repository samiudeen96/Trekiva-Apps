import { z } from "zod";

// Pure (no server imports): shared by the editor, the live preview, the renderer and the gateway.

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex color");
const text = (max: number) => z.string().trim().max(max);
const align = z.enum(["left", "center", "right"]);
const sectionId = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);

/** https only: these URLs are rendered into customers' inboxes. Empty means "none". */
const httpsUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((v) => v === "" || /^https:\/\//i.test(v), "Use an https URL");

/** A link: https, or one of the placeholders resolved when the email is sent. */
export const LINK_PLACEHOLDERS = ["{{discount_link}}", "{{shop_url}}"] as const;
const linkUrl = z
  .string()
  .trim()
  .max(2048)
  .refine(
    (v) => v === "" || /^https:\/\//i.test(v) || (LINK_PLACEHOLDERS as readonly string[]).includes(v),
    "Use an https URL, {{discount_link}} or {{shop_url}}",
  );

const header = z.object({
  type: z.literal("header"),
  id: sectionId,
  logoUrl: httpsUrl,
  logoWidth: z.coerce.number().int().min(40).max(400),
  align,
  backgroundColor: hex,
});
const textBlock = z.object({
  type: z.literal("text"),
  id: sectionId,
  heading: text(120),
  body: text(2000),
  align,
});
const image = z.object({
  type: z.literal("image"),
  id: sectionId,
  imageUrl: httpsUrl,
  alt: text(120),
  linkUrl,
});
const imageText = z.object({
  type: z.literal("imageText"),
  id: sectionId,
  imageUrl: httpsUrl,
  alt: text(120),
  heading: text(120),
  body: text(600),
  buttonLabel: text(40),
  buttonUrl: linkUrl,
  imagePosition: z.enum(["left", "right"]),
});
const discount = z.object({
  type: z.literal("discount"),
  id: sectionId,
  heading: text(120),
  description: text(400),
  note: text(300),
  buttonLabel: text(40),
  /** Where the button lands after the discount is applied, e.g. "/collections/sandals". "" = home page. */
  redirectPath: z
    .string()
    .trim()
    .max(200)
    .refine((v) => v === "" || (v.startsWith("/") && !v.startsWith("//")), "Start with a single /"),
});
const button = z.object({
  type: z.literal("button"),
  id: sectionId,
  label: text(40).min(1),
  url: linkUrl,
  align,
});
const columns = z.object({
  type: z.literal("columns"),
  id: sectionId,
  items: z.array(z.object({ title: text(60), text: text(200) })).min(2).max(3),
});

export const sectionSchema = z.discriminatedUnion("type", [header, textBlock, image, imageText, discount, button, columns]);

export const emailTemplateSchema = z.object({
  schemaVersion: z.literal(1),
  /** Separate from the visual template, as in a campaign tool. */
  subject: text(150).min(1),
  previewText: text(150),
  brand: z.object({
    backgroundColor: hex,
    contentBackgroundColor: hex,
    textColor: hex,
    buttonColor: hex,
    buttonTextColor: hex,
    fontFamily: z.enum(["sans", "serif"]),
    width: z.coerce.number().int().min(480).max(680),
  }),
  sections: z
    .array(sectionSchema)
    .min(1)
    .max(20)
    // A welcome email without the customer's code would be useless, so one is always required.
    .refine((s) => s.some((x) => x.type === "discount"), "Keep at least one discount section: it shows the code"),
  /** The footer is fixed and always last; the unsubscribe link in it cannot be removed. */
  footer: z.object({ address: text(300) }),
});

export type EmailSection = z.infer<typeof sectionSchema>;
export type EmailSectionType = EmailSection["type"];
export type EmailTemplate = z.infer<typeof emailTemplateSchema>;

/** Placeholders merchants can type into any text field. */
export const EMAIL_PLACEHOLDERS = [
  { token: "{{code}}", help: "The customer's own discount code" },
  { token: "{{first_name}}", help: 'First name, or "there" when unknown' },
  { token: "{{shop_name}}", help: "Your store / sender name" },
] as const;
