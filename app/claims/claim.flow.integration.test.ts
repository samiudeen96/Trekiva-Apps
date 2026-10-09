import { afterAll, beforeEach, describe, expect, it } from "vitest";
import db from "../db.server";
import { ClaimService } from "./claim.service";
import { TAG_CLAIMED } from "./handoff";
import { createCustomerGateway } from "../shopify/customers.server";
import * as C from "../shopify/customers.server";
import { createDiscountCodeGateway, ADD_CODE, BULK_STATUS, FIND_CODE } from "../discounts/redeem-codes.server";
import { createEmailGateway } from "../email/email.server";

/**
 * Real ClaimService + real Shopify gateways against a stateful fake Shopify. The fake records what
 * Flow would see at the instant the tag is ADDED, which is the guarantee the whole design rests on.
 */
interface FakeCustomer {
  id: string;
  email: string;
  tags: Set<string>;
  state: string;
  orders: number;
  metafields: Map<string, string>;
}
interface Fire {
  customerId: string;
  code: string | undefined;
  claimedFlag: string | undefined;
  codeRedeemable: boolean;
}

function fakeShopify(discountId: string) {
  const customers = new Map<string, FakeCustomer>();
  const codes = new Map<string, string>();
  const fires: Fire[] = [];
  const failNext = { metafields: 0, tags: 0 };
  const log: string[] = [];
  let seq = 0;

  const find = (email: string) => [...customers.values()].find((c) => c.email === email);
  const ok = (data: object) => Response.json({ data });

  const admin = {
    graphql: async (query: string, opts?: { variables?: Record<string, any> }) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const v = opts?.variables ?? {};
      switch (query) {
        case C.FIND_CUSTOMER: {
          const c = find(/email:"(.*)"/.exec(v.query)![1]);
          return ok({
            customers: {
              nodes: c
                ? [{ id: c.id, numberOfOrders: String(c.orders), tags: [...c.tags], defaultEmailAddress: { marketingState: c.state } }]
                : [],
            },
          });
        }
        case C.CREATE_CUSTOMER: {
          const id = `gid://shopify/Customer/${++seq}`;
          customers.set(id, {
            id,
            email: v.input.email,
            tags: new Set(v.input.tags ?? []),
            state: v.input.emailMarketingConsent ? "SUBSCRIBED" : "NOT_SUBSCRIBED",
            orders: 0,
            metafields: new Map(),
          });
          log.push("customerCreate");
          return ok({ customerCreate: { customer: { id }, userErrors: [] } });
        }
        case C.SUBSCRIBE_CUSTOMER:
          customers.get(v.input.customerId)!.state = "SUBSCRIBED";
          log.push("subscribe");
          return ok({ customerEmailMarketingConsentUpdate: { customer: { id: v.input.customerId }, userErrors: [] } });
        case FIND_CODE:
          return ok({ codeDiscountNodeByCode: codes.has(v.code) ? { id: codes.get(v.code) } : null });
        case ADD_CODE:
          codes.set(v.codes[0].code, v.discountId);
          log.push("codeAdd");
          return ok({ discountRedeemCodeBulkAdd: { bulkCreation: { id: "gid://shopify/DiscountRedeemCodeBulkCreation/1" }, userErrors: [] } });
        case BULK_STATUS:
          return ok({ discountRedeemCodeBulkCreation: { done: true, importedCount: 1, codes: { nodes: [{ errors: [] }] } } });
        case C.SET_METAFIELDS: {
          if (failNext.metafields > 0) {
            failNext.metafields--;
            return ok({ metafieldsSet: { metafields: [], userErrors: [{ field: ["metafields"], message: "boom" }] } });
          }
          for (const m of v.metafields) customers.get(m.ownerId)!.metafields.set(m.key, m.value);
          log.push("metafields");
          return ok({ metafieldsSet: { metafields: [], userErrors: [] } });
        }
        case C.REMOVE_TAGS:
          for (const t of v.tags) customers.get(v.id)!.tags.delete(t);
          log.push("tagRemove");
          return ok({ tagsRemove: { node: { id: v.id }, userErrors: [] } });
        case C.ADD_TAGS: {
          if (failNext.tags > 0) {
            failNext.tags--;
            return ok({ tagsAdd: { node: null, userErrors: [{ field: ["id"], message: "boom" }] } });
          }
          const c = customers.get(v.id)!;
          for (const t of v.tags as string[]) {
            // Flow's "Customer tags added" fires only when a tag is genuinely new on the customer.
            if (!c.tags.has(t) && t === TAG_CLAIMED) {
              const code = c.metafields.get("welcome_discount_code");
              fires.push({
                customerId: c.id,
                code,
                claimedFlag: c.metafields.get("welcome_offer_claimed"),
                codeRedeemable: code !== undefined && codes.get(code) === discountId,
              });
            }
            c.tags.add(t);
          }
          log.push("tagAdd");
          return ok({ tagsAdd: { node: { id: v.id }, userErrors: [] } });
        }
      }
      throw new Error(`unexpected query: ${query.slice(0, 60)}`);
    },
  };
  return { admin, customers, codes, fires, failNext, log, find };
}

/** A customer who already exists in the store before the popup is ever submitted. */
function seed(
  sh: ReturnType<typeof fakeShopify>,
  c: { email: string; tags?: string[]; orders?: number; state?: string },
) {
  const id = `gid://shopify/Customer/seed-${c.email}`;
  sh.customers.set(id, {
    id,
    email: c.email,
    tags: new Set(c.tags ?? []),
    state: c.state ?? "NOT_SUBSCRIBED",
    orders: c.orders ?? 0,
    metafields: new Map(),
  });
}

const shop = `flow-e2e-${Date.now()}.myshopify.com`;
const DISCOUNT_ID = "gid://shopify/DiscountCodeNode/1";
let campaignId: string;

const build = (shopify: ReturnType<typeof fakeShopify>) =>
  new ClaimService(
    createCustomerGateway(shopify.admin),
    createDiscountCodeGateway(shopify.admin, { pollMs: 0, maxPolls: 2 }),
  );
// What the public route does: submitting the popup is the opt-in.
const submit = (s: ClaimService, email: string) =>
  s.claim({ shopDomain: shop, campaignId, email, marketingConsent: true });
const rows = () => db.welcomeOfferClaim.findMany({ where: { shopDomain: shop } });

beforeEach(async () => {
  await db.welcomeOfferClaim.deleteMany({ where: { shopDomain: shop } });
  await db.campaign.deleteMany({ where: { shopDomain: shop } });
  campaignId = (
    await db.campaign.create({
      data: { shopDomain: shop, name: "Welcome", status: "ACTIVE", discountId: DISCOUNT_ID, discountCode: "WELCOME10", content: {}, design: {}, rules: { applyOnSignup: false } },
    })
  ).id;
});
afterAll(async () => {
  await db.welcomeOfferClaim.deleteMany({ where: { shopDomain: shop } });
  await db.campaign.deleteMany({ where: { shopDomain: shop } });
  await db.$disconnect();
});

describe("claim -> Shopify Flow handoff (end to end)", () => {
  it("when the tag lands, the code is redeemable and every metafield Flow reads already exists", async () => {
    const sh = fakeShopify(DISCOUNT_ID);
    expect((await submit(build(sh), " New@Customer.com ")).status).toBe("claimed");

    const [row] = await rows();
    expect(sh.fires).toEqual([
      { customerId: row.shopifyCustomerId, code: row.discountCode, claimedFlag: "true", codeRedeemable: true },
    ]);
    const c = sh.find("new@customer.com")!;
    expect(c.state).toBe("SUBSCRIBED"); // the popup submission is the opt-in
    expect(c.metafields.get("welcome_claim_id")).toBe(row.id);
    expect(c.metafields.get("welcome_campaign_id")).toBe(campaignId);
    expect(c.metafields.get("welcome_claimed_at")).toBe(row.claimedAt.toISOString());
    expect(sh.log.indexOf("metafields")).toBeLessThan(sh.log.indexOf("tagAdd"));
    expect(sh.log.indexOf("codeAdd")).toBeLessThan(sh.log.indexOf("metafields"));
  });

  it("keeps the existing customer's other tags and adds only the claim tag", async () => {
    const sh = fakeShopify(DISCOUNT_ID);
    seed(sh, { email: "vip@x.co", tags: ["vip", "wholesale"] });
    await submit(build(sh), "vip@x.co");
    expect([...sh.find("vip@x.co")!.tags].sort()).toEqual(["vip", TAG_CLAIMED, "wholesale"].sort());
    expect(sh.fires).toHaveLength(1);
    expect(sh.log).not.toContain("customerCreate");
    expect(sh.log).not.toContain("tagRemove");
  });

  it("a metafield failure fires nothing; the retry fires exactly once with the SAME single code", async () => {
    const sh = fakeShopify(DISCOUNT_ID);
    const svc = build(sh);
    sh.failNext.metafields = 1;
    await expect(submit(svc, "m@x.co")).rejects.toThrow(/metafieldsSet failed/);
    expect(sh.fires).toHaveLength(0);
    expect(sh.find("m@x.co")!.tags.has(TAG_CLAIMED)).toBe(false);

    expect((await submit(svc, "m@x.co")).status).toBe("claimed");
    const [row] = await rows();
    expect(sh.fires).toHaveLength(1);
    expect(sh.fires[0]).toMatchObject({ code: row.discountCode, codeRedeemable: true });
    expect([...sh.codes.keys()]).toEqual([row.discountCode]);
  });

  it("a tag failure fires nothing; the retry fires once and creates no second code", async () => {
    const sh = fakeShopify(DISCOUNT_ID);
    const svc = build(sh);
    sh.failNext.tags = 1;
    await expect(submit(svc, "t@x.co")).rejects.toThrow(/tagsAdd failed/);
    expect(sh.fires).toHaveLength(0);
    await submit(svc, "t@x.co");
    expect(sh.fires).toHaveLength(1);
    expect(sh.codes.size).toBe(1);
  });

  it("20 simultaneous submissions (mixed casing) make one claim, one code and one Flow start", async () => {
    const sh = fakeShopify(DISCOUNT_ID);
    const svc = build(sh);
    const emails = Array.from({ length: 20 }, (_, i) => (i % 2 ? "Race@X.co" : " race@x.CO"));
    const results = await Promise.all(emails.map((e) => submit(svc, e)));
    expect(results.filter((r) => r.status === "claimed")).toHaveLength(1);
    expect(sh.fires).toHaveLength(1);
    expect(sh.codes.size).toBe(1);
    expect(await rows()).toHaveLength(1);
  });

  it("deleting a claim and claiming again starts Flow again, with the new code", async () => {
    const sh = fakeShopify(DISCOUNT_ID);
    const svc = build(sh);
    await submit(svc, "redo@x.co");
    const [first] = await rows();
    await db.welcomeOfferClaim.delete({ where: { id: first.id } });

    expect((await submit(svc, "redo@x.co")).status).toBe("claimed");
    const [second] = await rows();
    expect(second.discountCode).not.toBe(first.discountCode);
    expect(sh.fires).toHaveLength(2);
    expect(sh.fires[1]).toMatchObject({ code: second.discountCode, codeRedeemable: true });
    expect(sh.log.filter((l) => l === "tagRemove")).toHaveLength(1);
    expect(sh.find("redo@x.co")!.tags.has(TAG_CLAIMED)).toBe(true);
  });

  it("never re-subscribes a customer who unsubscribed; the claim stays valid and is flagged", async () => {
    const sh = fakeShopify(DISCOUNT_ID);
    const svc = build(sh);
    await submit(svc, "gone@x.co"); // creates the customer
    sh.find("gone@x.co")!.state = "UNSUBSCRIBED";
    await db.welcomeOfferClaim.deleteMany({ where: { shopDomain: shop } });

    expect((await submit(svc, "gone@x.co")).status).toBe("claimed");
    expect(sh.find("gone@x.co")!.state).toBe("UNSUBSCRIBED");
    expect(sh.log).not.toContain("subscribe");
    expect((await rows())[0]).toMatchObject({ emailStatus: "READY_FOR_FLOW", emailEligibility: "NOT_SUBSCRIBED" });
  });

  it("subscribes a customer who never chose, because submitting the popup is the opt-in", async () => {
    const sh = fakeShopify(DISCOUNT_ID);
    const svc = build(sh);
    await submit(svc, "never@x.co");
    sh.find("never@x.co")!.state = "NOT_SUBSCRIBED";
    await db.welcomeOfferClaim.deleteMany({ where: { shopDomain: shop } });
    await submit(svc, "never@x.co");
    expect(sh.find("never@x.co")!.state).toBe("SUBSCRIBED");
    expect(sh.log).toContain("subscribe");
  });

  it("a returning customer is refused up front: no code, no metafields, no tag, no Flow start", async () => {
    await db.campaign.update({ where: { id: campaignId }, data: { rules: { firstPurchaseOnly: true, applyOnSignup: false } } });
    const sh = fakeShopify(DISCOUNT_ID);
    seed(sh, { email: "regular@x.co", orders: 3, tags: ["vip"] });

    expect((await submit(build(sh), "regular@x.co")).status).toBe("not_eligible");
    expect(sh.log).toEqual([]);
    expect(sh.fires).toHaveLength(0);
    expect(sh.codes.size).toBe(0);
    expect([...sh.find("regular@x.co")!.tags]).toEqual(["vip"]);
    expect(await rows()).toHaveLength(0);
  });

  it("lets a first-time customer through when the rule is on", async () => {
    await db.campaign.update({ where: { id: campaignId }, data: { rules: { firstPurchaseOnly: true, applyOnSignup: false } } });
    const sh = fakeShopify(DISCOUNT_ID);
    seed(sh, { email: "browser@x.co", orders: 0 });
    expect((await submit(build(sh), "browser@x.co")).status).toBe("claimed");
    expect(sh.fires).toHaveLength(1);
  });
});

describe("claim -> email sent by the app (end to end)", () => {
  const cfg = {
    apiKey: "re_test",
    from: "Trekiva <care@trekiva.com>",
    appUrl: "https://discount.trekiva.in",
    secret: "app-secret",
  };

  /** A fake Resend: records every request and can be told to fail. */
  function fakeResend() {
    const sent: { headers: Record<string, string>; body: { to: string[]; subject: string; html: string; text: string } }[] = [];
    const state = { fail: 0 };
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      if (state.fail > 0) {
        state.fail--;
        return new Response('{"message":"rate limited"}', { status: 429 });
      }
      sent.push({ headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
      return new Response('{"id":"e_1"}', { status: 200 });
    }) as unknown as typeof fetch;
    return { sent, state, fetchImpl };
  }
  const buildApp = (sh: ReturnType<typeof fakeShopify>, resend: ReturnType<typeof fakeResend>) =>
    new ClaimService(
      createCustomerGateway(sh.admin),
      createDiscountCodeGateway(sh.admin, { pollMs: 0, maxPolls: 2 }),
      createEmailGateway(cfg, resend.fetchImpl),
    );

  it("emails the customer their own redeemable code, and never starts a Flow workflow", async () => {
    const sh = fakeShopify(DISCOUNT_ID);
    const resend = fakeResend();
    expect((await submit(buildApp(sh, resend), "Buyer@X.co")).status).toBe("claimed");

    const [row] = await rows();
    expect(resend.sent).toHaveLength(1);
    const mail = resend.sent[0];
    expect(mail.body.to).toEqual(["buyer@x.co"]);
    expect(mail.body.html).toContain(row.discountCode);
    expect(mail.body.html).toContain(`https://${shop}/discount/${row.discountCode}`);
    expect(mail.body.text).toContain(row.discountCode);
    expect(mail.headers["Idempotency-Key"]).toBe(`welcome-offer-${row.id}`);
    // The code in the email works at checkout, and no Flow tag was added.
    expect(sh.codes.get(row.discountCode)).toBe(DISCOUNT_ID);
    expect(sh.fires).toHaveLength(0);
    expect(sh.find("buyer@x.co")!.tags.has(TAG_CLAIMED)).toBe(false);
    expect(row).toMatchObject({ delivery: "APP", emailStatus: "EMAIL_SENT" });
  });

  it("a customer who unsubscribed gets only their code and no marketing footer", async () => {
    const sh = fakeShopify(DISCOUNT_ID);
    const resend = fakeResend();
    seed(sh, { email: "gone@x.co", state: "UNSUBSCRIBED" });
    await submit(buildApp(sh, resend), "gone@x.co");
    const { html } = resend.sent[0].body;
    expect(sh.find("gone@x.co")!.state).toBe("UNSUBSCRIBED"); // never re-subscribed
    expect(html).toContain((await rows())[0].discountCode);
    expect(html).not.toContain("/unsubscribe");
    expect(html).toContain("not subscribed to marketing email");
  });

  it("a Resend outage fails the claim; the retry sends once with the same code and idempotency key", async () => {
    const sh = fakeShopify(DISCOUNT_ID);
    const resend = fakeResend();
    const svc = buildApp(sh, resend);
    resend.state.fail = 1;
    await expect(submit(svc, "retry@x.co")).rejects.toThrow(/429/);
    expect(resend.sent).toHaveLength(0);
    expect((await rows())[0]).toMatchObject({ emailStatus: "FAILED", failureStep: "email" });

    expect((await submit(svc, "retry@x.co")).status).toBe("claimed");
    const [row] = await rows();
    expect(resend.sent).toHaveLength(1);
    expect(resend.sent[0].headers["Idempotency-Key"]).toBe(`welcome-offer-${row.id}`);
    expect([...sh.codes.keys()]).toEqual([row.discountCode]); // still exactly one code in Shopify
  });

  it("20 simultaneous submissions send one email", async () => {
    const sh = fakeShopify(DISCOUNT_ID);
    const resend = fakeResend();
    const svc = buildApp(sh, resend);
    await Promise.all(Array.from({ length: 20 }, () => submit(svc, "Race@X.co")));
    expect(resend.sent).toHaveLength(1);
    expect(sh.codes.size).toBe(1);
  });
});
