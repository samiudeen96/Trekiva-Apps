import { describe, expect, it, vi } from "vitest";
import { createEmailGateway, getEmailBranding } from "./email.server";

const input = {
  claimId: "clm_123",
  shopDomain: "s.myshopify.com",
  email: "a@b.co",
  campaignName: "Welcome 10% Popup",
  discountCode: "WELCOME10-AB2CD3EF",
  claimedAt: new Date("2026-10-02T10:00:00Z"),
  customerId: "gid://shopify/Customer/123",
  emailContent: {
    subject: "Your welcome offer code",
    heading: "Welcome to {{brand}}",
    body: "Use {{code}} at checkout.",
  },
};

const ok = () =>
  vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ id: "re_1" }), { status: 200 }));
type FetchMock = ReturnType<typeof ok>;
const init = (f: FetchMock) => f.mock.calls[0][1] as RequestInit;
const body = (f: FetchMock) => JSON.parse(init(f).body as string);
const headers = (f: FetchMock) => init(f).headers as Record<string, string>;

describe("getEmailBranding", () => {
  it("takes the brand from EMAIL_FROM and the logo from env", () => {
    const b = getEmailBranding();
    expect(b.brand).toBe("Trekiva");
    expect(b.logoUrl).toMatch(/^https:\/\/cdn\.shopify\.com\/.*format=jpg$/);
  });
});

describe("email gateway", () => {
  it("posts the campaign's email to Resend with the code filled in", async () => {
    const f = ok();
    await createEmailGateway(f).sendWelcomeOffer(input);
    expect(f.mock.calls[0][0]).toBe("https://api.resend.com/emails");
    expect(body(f)).toMatchObject({
      from: "Trekiva <offers@test.example.com>",
      to: ["a@b.co"],
      subject: "Your welcome offer code",
    });
    expect(body(f).html).toContain("Welcome to Trekiva");
    expect(body(f).html).toContain("Use WELCOME10-AB2CD3EF at checkout.");
    expect(body(f).text).toContain("WELCOME10-AB2CD3EF");
  });

  it("keys the send on the claim so a retry cannot send twice", async () => {
    const f = ok();
    await createEmailGateway(f).sendWelcomeOffer(input);
    expect(headers(f)["Idempotency-Key"]).toBe("welcome-offer-clm_123");
  });

  it("never leaks the merchant's internal campaign name to the customer", async () => {
    const f = ok();
    await createEmailGateway(f).sendWelcomeOffer(input);
    const sent = body(f);
    expect(sent.html).not.toContain("Welcome 10% Popup");
    expect(sent.text).not.toContain("Welcome 10% Popup");
    expect(sent.subject).not.toContain("Welcome 10% Popup");
  });

  it("throws on a rejected send so the claim is marked FAILED", async () => {
    const f = vi.fn<typeof fetch>(async () => new Response("domain not verified", { status: 403 }));
    await expect(createEmailGateway(f).sendWelcomeOffer(input)).rejects.toThrow(/403/);
  });
});
