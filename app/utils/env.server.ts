import { z } from "zod";

// docker compose passes an unset variable through as "", which must mean "not configured", not "invalid".
const blankAsUnset = <T extends z.ZodType>(t: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), t.optional());

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
  // Resend sends the welcome email. Both unset = the app sends nothing and Shopify Flow does (the
  // earlier setup), so deploying this change never breaks a store that has not configured Resend yet.
  RESEND_API_KEY: blankAsUnset(z.string().min(1)),
  // RFC 5322 sender on a domain verified in Resend, e.g. "Trekiva <care@trekiva.com>".
  EMAIL_FROM: blankAsUnset(z.string().min(3)),
  EMAIL_REPLY_TO: blankAsUnset(z.string().email()),
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
