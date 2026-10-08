/**
 * Pulls every string from an order webhook that could be a discount code.
 *
 * Deliberately broad: checkout apps record the discount in their own way. COD King, for one,
 * applies the amount itself and leaves the code only in a note attribute
 * (`_codkDiscounts: "orderLevel:99.9|WELCOME10-TS73UDMA"`), so reading `discount_codes` alone
 * would miss it. Being broad is safe because the caller keeps only the candidates that exactly
 * match a code Trekiva itself issued; everything else is ignored.
 */

interface OrderPayload {
  discount_codes?: { code?: unknown }[] | null;
  discount_applications?: { code?: unknown; title?: unknown }[] | null;
  note_attributes?: { name?: unknown; value?: unknown }[] | null;
}

/**
 * The shape every Trekiva code has: an alphanumeric prefix, one dash, a random suffix
 * ("WELCOME10-7KQ2M9XH"). Anything else cannot be ours, so it is dropped before we even look it
 * up. A code that somehow failed this test would simply not be revoked, which leaves things
 * exactly as they are today; that is the safe direction to fail in.
 */
const SHAPE = /^[A-Z0-9]{1,24}-[A-Z0-9]{6,12}$/;
/** Note attributes pack several values together, e.g. "orderLevel:99.9|WELCOME10-TS73UDMA". */
const SEPARATORS = /[|,;:\s]+/;

function add(out: Set<string>, raw: unknown) {
  if (typeof raw !== "string") return;
  const value = raw.trim().toUpperCase();
  if (SHAPE.test(value)) out.add(value);
}

export function redeemedCodeCandidates(payload: unknown): string[] {
  const order = (payload ?? {}) as OrderPayload;
  const out = new Set<string>();

  for (const d of order.discount_codes ?? []) add(out, d?.code);
  for (const a of order.discount_applications ?? []) {
    add(out, a?.code);
    // A custom order-level discount carries the code as its title, with no `code` field at all.
    add(out, a?.title);
  }
  for (const n of order.note_attributes ?? []) {
    if (typeof n?.value !== "string") continue;
    for (const part of n.value.split(SEPARATORS)) add(out, part);
  }
  return [...out];
}
