import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  SHOPIFY_API_KEY: z.string().min(1),
  SHOPIFY_API_SECRET: z.string().min(1),
  SHOPIFY_APP_URL: z.string().url(),
  SCOPES: z
    .string()
    .min(1)
    .transform((s) =>
      s
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  DATABASE_URL: z.string().startsWith("postgres"),
  SHOP_CUSTOM_DOMAIN: z.string().optional(),
  LOG_LEVEL: z
    .enum(["silent", "fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  CLAIM_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(10),
  // Resend delivers the welcome-offer email (Shopify Flow is Plus-only for custom apps).
  RESEND_API_KEY: z.string().min(1),
  // RFC 5322 sender on a domain verified in Resend, e.g. "Trekiva <offers@trekiva.com>".
  EMAIL_FROM: z.string().min(3),
  EMAIL_REPLY_TO: z.string().email().optional(),
  // https image shown at the top of the email; "" for none. Use JPG/PNG: Outlook cannot render webp.
  EMAIL_LOGO_URL: z
    .string()
    .default(
      "https://cdn.shopify.com/s/files/1/0757/5928/8474/files/brand_banner.webp?v=1789714241&format=jpg",
    )
    .refine((v) => v === "" || /^https:\/\//i.test(v), "EMAIL_LOGO_URL must be an https URL"),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    // Fail fast: never boot with a partial configuration.
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env = load();
