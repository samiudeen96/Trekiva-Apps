import { describe, expect, it, vi } from "vitest";
import { createEmailGateway, discountBase, emailConfig, senderName, type EmailConfig } from "./email.server";
import { defaultEmail, newSection } from "./defaults";
import type { EmailTemplate } from "./schema";
import { verifyUnsubscribe } from "./unsubscribe";

const cfg: EmailConfig = {
  apiKey: "re_test",
  from: "Trekiva <care@trekiva.com>",
  replyTo: "help@trekiva.com",
  appUrl: "https://discount.trekiva.in",
  secret: "app-secret",
};
const base = {
  claimId: "claim_1",
  shopDomain: "shop-one.myshopify.com",
  email: "a@b.co",
  customerId: "gid://shopify/Customer/5",
  firstName: "Asha" as string | null,
  discountCode: "WELCOME10-7KQ2M9XH",
  emailEligibility: "SUBSCRIBED" as const,
  template: defaultEmail,
};

function resend(status = 200, body = "") {
  const fetchImpl = vi.fn(async () => new Response(body, { status }));
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls: fetchImpl.mock.calls as unknown as [string, RequestInit][] };
}
const payload = (c: [string, RequestInit][]) => JSON.parse(String(c[0][1].body));
const headers = (c: [string, RequestInit][]) => c[0][1].headers as Record<string, string>;

describe("Resend gateway: welcome email", () => {
  it("sends the customer's own code from the configured sender", async () => {
    const { fetchImpl, calls } = resend();
    await createEmailGateway(cfg, fetchImpl).sendWelcomeOffer(base);
    expect(calls[0][0]).toBe("https://api.resend.com/emails");
    expect(headers(calls).Authorization).toBe("Bearer re_test");
    const p = payload(calls);
    expect(p).toMatchObject({ from: cfg.from, to: ["a@b.co"], reply_to: "help@trekiva.com" });
    expect(p.subject).toBe("Your welcome offer from Trekiva");
    expect(p.html).toContain("WELCOME10-7KQ2M9XH");
    expect(p.html).toContain(discountBase("https://shop-one.myshopify.com", "WELCOME10-7KQ2M9XH"));
    expect(p.html).toContain("Hi Asha,");
    expect(p.text).toContain("WELCOME10-7KQ2M9XH");
  });

  it("uses one idempotency key per claim, so a retry can never send a second email", async () => {
    const a = resend();
    const b = resend();
    await createEmailGateway(cfg, a.fetchImpl).sendWelcomeOffer(base);
    await createEmailGateway(cfg, b.fetchImpl).sendWelcomeOffer(base);
    expect(headers(a.calls)["Idempotency-Key"]).toBe("welcome-offer-claim_1");
    expect(headers(b.calls)["Idempotency-Key"]).toBe("welcome-offer-claim_1");
    const c = resend();
    await createEmailGateway(cfg, c.fetchImpl).sendWelcomeOffer({ ...base, claimId: "claim_2" });
    expect(headers(c.calls)["Idempotency-Key"]).toBe("welcome-offer-claim_2");
  });

  it("a subscribed customer gets a signed one-click unsubscribe link and header", async () => {
    const { fetchImpl, calls } = resend();
    await createEmailGateway(cfg, fetchImpl).sendWelcomeOffer(base);
    const p = payload(calls);
    const link = /href="(https:\/\/discount\.trekiva\.in\/unsubscribe\?t=[^"]+)"/.exec(p.html)![1];
    expect(verifyUnsubscribe(new URL(link).searchParams.get("t")!, cfg.secret)).toEqual({
      shop: base.shopDomain,
      customerId: base.customerId,
    });
    expect(p.headers["List-Unsubscribe"]).toBe(`<${link}>`);
    expect(p.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it.each(["NOT_SUBSCRIBED", "UNKNOWN"] as const)("%s gets only their code: no marketing, no unsubscribe", async (emailEligibility) => {
    const { fetchImpl, calls } = resend();
    await createEmailGateway(cfg, fetchImpl).sendWelcomeOffer({ ...base, emailEligibility });
    const p = payload(calls);
    expect(p.html).toContain("WELCOME10-7KQ2M9XH");
    expect(p.html).not.toContain("Welcome to Trekiva");
    expect(p.html).not.toContain("/unsubscribe");
    expect(p.headers).toBeUndefined();
  });

  it("throws on a Resend failure so the claim is marked failed and retried", async () => {
    const { fetchImpl } = resend(403, '{"message":"domain not verified"}');
    await expect(createEmailGateway(cfg, fetchImpl).sendWelcomeOffer(base)).rejects.toThrow(/403.*domain not verified/);
  });

  it("falls back to the shop domain when the sender has no display name", async () => {
    const { fetchImpl, calls } = resend();
    await createEmailGateway({ ...cfg, from: "care@trekiva.com" }, fetchImpl).sendWelcomeOffer(base);
    expect(payload(calls).subject).toBe("Your welcome offer from shop-one.myshopify.com");
  });
});

describe("Resend gateway: links use the store's own domain", () => {
  it("builds the discount and store links on the domain customers shop on", async () => {
    const { fetchImpl, calls } = resend();
    await createEmailGateway(cfg, fetchImpl, async () => "https://trekiva.com").sendWelcomeOffer(base);
    const p = payload(calls);
    expect(p.html).toContain('href="https://trekiva.com/discount/WELCOME10-7KQ2M9XH"');
    expect(p.html).not.toContain("myshopify.com");
    expect(p.text).toContain("https://trekiva.com/discount/WELCOME10-7KQ2M9XH");
  });

  it("does so for the test email too", async () => {
    const { fetchImpl, calls } = resend();
    await createEmailGateway(cfg, fetchImpl, async () => "https://trekiva.com").sendTest({
      to: "me@x.co", shopDomain: base.shopDomain, template: defaultEmail,
    });
    expect(payload(calls).html).toContain("https://trekiva.com/discount/");
  });
});

describe("Resend gateway: products", () => {
  const withProducts: EmailTemplate = {
    ...defaultEmail,
    sections: [...defaultEmail.sections, { ...newSection("product"), id: "p1", heading: "More for you" } as EmailTemplate["sections"][number]],
  };
  const card = { title: "Sandal", url: "https://trekiva.com/products/s", imageUrl: "", imageAlt: "", price: "$10.00" };

  it("shows live products to a subscribed customer", async () => {
    const { fetchImpl, calls } = resend();
    await createEmailGateway(cfg, fetchImpl, undefined, async () => ({ p1: [card] })).sendWelcomeOffer({ ...base, template: withProducts });
    expect(payload(calls).html).toContain("More for you");
    expect(payload(calls).html).toContain("https://trekiva.com/products/s");
  });

  it("does not look products up for someone who only gets their code", async () => {
    const { fetchImpl, calls } = resend();
    const look = vi.fn(async () => ({ p1: [card] }));
    await createEmailGateway(cfg, fetchImpl, undefined, look).sendWelcomeOffer({ ...base, template: withProducts, emailEligibility: "NOT_SUBSCRIBED" });
    expect(look).not.toHaveBeenCalled();
    expect(payload(calls).html).not.toContain("More for you");
  });

  it("still sends the code when the product lookup fails", async () => {
    const { fetchImpl, calls } = resend();
    await createEmailGateway(cfg, fetchImpl, undefined, async () => { throw new Error("denied"); }).sendWelcomeOffer({ ...base, template: withProducts });
    expect(payload(calls).html).toContain("WELCOME10-7KQ2M9XH");
    expect(payload(calls).html).not.toContain("More for you");
  });

  it("the test email falls back to sample products when none can be loaded", async () => {
    const { fetchImpl, calls } = resend();
    await createEmailGateway(cfg, fetchImpl, undefined, async () => ({})).sendTest({ to: "me@x.co", shopDomain: base.shopDomain, template: withProducts });
    expect(payload(calls).html).toContain("Sample product 1");
  });
});

describe("Resend gateway: test email", () => {
  it("sends the unsaved template with a sample code, marked [Test], never idempotent", async () => {
    const { fetchImpl, calls } = resend();
    await createEmailGateway(cfg, fetchImpl).sendTest({
      to: "me@x.co",
      shopDomain: base.shopDomain,
      template: { ...defaultEmail, subject: "Draft {{shop_name}}" },
    });
    const p = payload(calls);
    expect(p.subject).toBe("[Test] Draft Trekiva");
    expect(p.html).toContain("WELCOME10-7KQ2M9XH");
    expect(headers(calls)["Idempotency-Key"]).toBeUndefined();
  });
});

describe("config helpers", () => {
  it("emailConfig is null when Resend is not configured (the app then leaves delivery to Flow)", () => {
    expect(emailConfig()).toBeNull();
  });

  it("senderName reads the display name of an RFC 5322 sender", () => {
    expect(senderName("Trekiva <care@trekiva.com>")).toBe("Trekiva");
    expect(senderName('"Trekiva Store" <care@trekiva.com>')).toBe("Trekiva Store");
    expect(senderName("care@trekiva.com")).toBeUndefined();
  });
});
