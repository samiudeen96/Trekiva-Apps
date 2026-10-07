import { createHmac, timingSafeEqual } from "node:crypto";

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const sign = (payload: string, secret: string) =>
  b64(createHmac("sha256", secret).update(`trekiva-unsubscribe:${payload}`).digest());

const SHOP = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;
const CUSTOMER = /^gid:\/\/shopify\/Customer\/\d+$/;

/**
 * A link that can unsubscribe one customer, without a login. Signed with the app secret so it cannot
 * be forged for another customer, and it carries no expiry: an unsubscribe link must keep working.
 */
export function signUnsubscribe(input: { shop: string; customerId: string }, secret: string): string {
  const payload = b64(JSON.stringify({ s: input.shop, c: input.customerId }));
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyUnsubscribe(token: string, secret: string): { shop: string; customerId: string } | null {
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const { s, c } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { s?: unknown; c?: unknown };
    if (typeof s !== "string" || typeof c !== "string" || !SHOP.test(s) || !CUSTOMER.test(c)) return null;
    return { shop: s, customerId: c };
  } catch {
    return null;
  }
}
