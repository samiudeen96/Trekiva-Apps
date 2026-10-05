import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["app/**/*.test.ts"],
    fileParallelism: false,
    env: {
      NODE_ENV: "test",
      SHOPIFY_API_KEY: "test",
      SHOPIFY_API_SECRET: "test",
      SHOPIFY_APP_URL: "https://test.example.com",
      SCOPES: "read_customers",
      LOG_LEVEL: "silent",
      RESEND_API_KEY: "test-resend-key",
      EMAIL_FROM: "Trekiva <offers@test.example.com>",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgresql://trekiva:change-me@localhost:5433/trekiva?schema=public",
    },
  },
});
