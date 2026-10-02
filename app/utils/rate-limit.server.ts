import { RateLimiterMemory } from "rate-limiter-flexible";
import { env } from "./env.server";

// In-memory: correct for the single-instance Elestio deployment. Swap for the
// Redis/Postgres limiter if the app is ever scaled horizontally.
const claimLimiter = new RateLimiterMemory({
  points: env.CLAIM_RATE_LIMIT_PER_MIN,
  duration: 60,
});

// Per-shop ceiling across all visitors: bounds abuse even if the forwarded client IP
// can be varied by an attacker.
const shopLimiter = new RateLimiterMemory({
  points: env.CLAIM_RATE_LIMIT_PER_MIN * 30,
  duration: 60,
});

export async function allowClaimAttempt(shop: string, ip: string): Promise<boolean> {
  try {
    await shopLimiter.consume(shop);
    await claimLimiter.consume(`${shop}:${ip}`);
    return true;
  } catch {
    return false;
  }
}

export function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
