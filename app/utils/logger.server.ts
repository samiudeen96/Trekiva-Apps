import pino from "pino";
import { env } from "./env.server";

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { app: "trekiva-app" },
  // Never log tokens, secrets or raw emails.
  redact: {
    paths: [
      "accessToken",
      "*.accessToken",
      "refreshToken",
      "*.refreshToken",
      "email",
      "*.email",
      "req.headers.authorization",
      "req.headers.cookie",
    ],
    censor: "[redacted]",
  },
  ...(env.NODE_ENV === "development"
    ? { transport: { target: "pino-pretty" } }
    : {}),
});

export type Logger = typeof logger;
