import { describe, expect, it, vi } from "vitest";
import {
  ADD_TAGS,
  CREATE_CUSTOMER,
  FIND_CUSTOMER,
  REMOVE_TAGS,
  SET_METAFIELDS,
  SUBSCRIBE_CUSTOMER,
  createCustomerGateway,
  eligibilityFor,
  unsubscribeCustomer,
} from "./customers.server";

const ID = "gid://shopify/Customer/1";

function admin(marketingState: string | null | "no-address", extra: { tags?: string[]; userErrors?: Record<string, object[]> } = {}) {
  const errs = extra.userErrors ?? {};
  return {
    graphql: vi.fn(async (query: string) => {
      if (query === FIND_CUSTOMER) {
        const nodes =
          marketingState === null
            ? []
            : [
                {
                  id: ID,
                  numberOfOrders: "0",
                  tags: extra.tags ?? [],
                  defaultEmailAddress: marketingState === "no-address" ? null : { marketingState },
                },
              ];
        return Response.json({ data: { customers: { nodes } } });
      }
      if (query === SUBSCRIBE_CUSTOMER) {
        return Response.json({ data: { customerEmailMarketingConsentUpdate: { customer: { id: ID }, userErrors: [] } } });
      }
      if (query === CREATE_CUSTOMER) {
        return Response.json({ data: { customerCreate: { customer: { id: ID }, userErrors: [] } } });
      }
      if (query === SET_METAFIELDS) {
        return Response.json({ data: { metafieldsSet: { metafields: [], userErrors: errs.metafields ?? [] } } });
      }
      if (query === REMOVE_TAGS) {
        return Response.json({ data: { tagsRemove: { node: { id: ID }, userErrors: errs.remove ?? [] } } });
      }
      if (query === ADD_TAGS) {
        return Response.json({ data: { tagsAdd: { node: { id: ID }, userErrors: errs.tags ?? [] } } });
      }
      throw new Error("unexpected query");
    }),
  };
}

type Call = [string, { variables: Record<string, any> }]; // eslint-disable-line @typescript-eslint/no-explicit-any
const calls = (a: ReturnType<typeof admin>, q: string) => a.graphql.mock.calls.filter(([x]) => x === q) as unknown as Call[];

describe("customer gateway: marketing consent", () => {
  it("creates a new customer WITHOUT consent unless the popup checkbox was ticked", async () => {
    const a = admin(null);
    expect(await createCustomerGateway(a).findOrCreate({ email: "a@b.co", marketingConsent: false })).toEqual({
      id: ID,
      firstName: null,
      emailEligibility: "NOT_SUBSCRIBED",
      alreadyTagged: false,
    });
    const [[, { variables }]] = calls(a, CREATE_CUSTOMER);
    expect(variables.input.emailMarketingConsent).toBeUndefined();
    expect(variables.input.email).toBe("a@b.co");
  });

  it("creates a new customer as subscribed when the checkbox was ticked", async () => {
    const a = admin(null);
    expect((await createCustomerGateway(a).findOrCreate({ email: "a@b.co", marketingConsent: true })).emailEligibility).toBe(
      "SUBSCRIBED",
    );
    const [[, { variables }]] = calls(a, CREATE_CUSTOMER);
    expect(variables.input.emailMarketingConsent).toMatchObject({
      marketingState: "SUBSCRIBED",
      marketingOptInLevel: "SINGLE_OPT_IN",
    });
  });

  it("leaves a customer who never chose as they are when the checkbox was not ticked", async () => {
    const a = admin("NOT_SUBSCRIBED");
    expect((await createCustomerGateway(a).findOrCreate({ email: "a@b.co", marketingConsent: false })).emailEligibility).toBe(
      "NOT_SUBSCRIBED",
    );
    expect(calls(a, SUBSCRIBE_CUSTOMER)).toHaveLength(0);
  });

  it("subscribes a customer who never chose only on explicit consent", async () => {
    const a = admin("NOT_SUBSCRIBED");
    expect((await createCustomerGateway(a).findOrCreate({ email: "a@b.co", marketingConsent: true })).emailEligibility).toBe(
      "SUBSCRIBED",
    );
    const [[, { variables }]] = calls(a, SUBSCRIBE_CUSTOMER);
    expect(variables.input).toMatchObject({
      customerId: ID,
      emailMarketingConsent: { marketingState: "SUBSCRIBED", marketingOptInLevel: "SINGLE_OPT_IN" },
    });
  });

  it("keeps a subscribed customer subscribed without touching consent", async () => {
    for (const consent of [true, false]) {
      const a = admin("SUBSCRIBED");
      expect((await createCustomerGateway(a).findOrCreate({ email: "a@b.co", marketingConsent: consent })).emailEligibility).toBe(
        "SUBSCRIBED",
      );
      expect(calls(a, SUBSCRIBE_CUSTOMER)).toHaveLength(0);
    }
  });

  it.each(["UNSUBSCRIBED", "PENDING", "INVALID"])("never overrides %s, even with the checkbox ticked", async (state) => {
    const a = admin(state);
    expect((await createCustomerGateway(a).findOrCreate({ email: "a@b.co", marketingConsent: true })).emailEligibility).toBe(
      "NOT_SUBSCRIBED",
    );
    expect(calls(a, SUBSCRIBE_CUSTOMER)).toHaveLength(0);
  });

  it("reports an unknown consent state as UNKNOWN and does not change it", async () => {
    const a = admin("no-address");
    expect((await createCustomerGateway(a).findOrCreate({ email: "a@b.co", marketingConsent: true })).emailEligibility).toBe(
      "UNKNOWN",
    );
    expect(calls(a, SUBSCRIBE_CUSTOMER)).toHaveLength(0);
  });

  it("maps Shopify marketing states to delivery eligibility", () => {
    expect(eligibilityFor("SUBSCRIBED")).toBe("SUBSCRIBED");
    for (const s of ["NOT_SUBSCRIBED", "UNSUBSCRIBED", "PENDING", "INVALID"]) expect(eligibilityFor(s)).toBe("NOT_SUBSCRIBED");
    for (const s of [undefined, null, "REDACTED", "SOMETHING_NEW"]) expect(eligibilityFor(s)).toBe("UNKNOWN");
  });
});

describe("customer gateway: greeting name", () => {
  it("returns an existing customer's first name for the email greeting", async () => {
    const a = admin("SUBSCRIBED");
    a.graphql.mockImplementationOnce(async () =>
      Response.json({
        data: { customers: { nodes: [{ id: ID, firstName: "Asha", numberOfOrders: "0", tags: [], defaultEmailAddress: { marketingState: "SUBSCRIBED" } }] } },
      }),
    );
    expect((await createCustomerGateway(a).findOrCreate({ email: "a@b.co", marketingConsent: false })).firstName).toBe("Asha");
  });
});

describe("customer gateway: existing tag", () => {
  it("reports when the customer already carries the claim tag (case-insensitively)", async () => {
    const a = admin("SUBSCRIBED", { tags: ["vip", "Trekiva_Welcome_Claimed"] });
    expect((await createCustomerGateway(a).findOrCreate({ email: "a@b.co", marketingConsent: false })).alreadyTagged).toBe(true);
  });

  it("reports false when it does not", async () => {
    const a = admin("SUBSCRIBED", { tags: ["vip"] });
    expect((await createCustomerGateway(a).findOrCreate({ email: "a@b.co", marketingConsent: false })).alreadyTagged).toBe(false);
  });
});

describe("customer gateway: metafields", () => {
  const input = {
    customerId: ID,
    discountCode: "WELCOME10-7KQ2M9XH",
    claimedAt: new Date("2026-10-07T10:00:00.000Z"),
    campaignId: "camp_1",
    claimId: "claim_1",
  };

  it("writes every trekiva.* metafield Flow needs in one upsert", async () => {
    const a = admin("SUBSCRIBED");
    await createCustomerGateway(a).writeClaimMetafields(input);
    const [[, { variables }]] = calls(a, SET_METAFIELDS);
    const byKey = Object.fromEntries(variables.metafields.map((m: { key: string }) => [m.key, m]));
    expect(Object.keys(byKey).sort()).toEqual([
      "welcome_campaign_id",
      "welcome_claim_id",
      "welcome_claimed_at",
      "welcome_discount_code",
      "welcome_offer_claimed",
    ]);
    expect(byKey.welcome_offer_claimed).toMatchObject({ type: "boolean", value: "true" });
    expect(byKey.welcome_discount_code).toMatchObject({ type: "single_line_text_field", value: "WELCOME10-7KQ2M9XH" });
    expect(byKey.welcome_claimed_at).toMatchObject({ type: "date_time", value: "2026-10-07T10:00:00.000Z" });
    expect(byKey.welcome_campaign_id.value).toBe("camp_1");
    expect(byKey.welcome_claim_id.value).toBe("claim_1");
    for (const m of variables.metafields) expect(m).toMatchObject({ ownerId: ID, namespace: "trekiva" });
  });

  it("treats userErrors as a real failure", async () => {
    const a = admin("SUBSCRIBED", { userErrors: { metafields: [{ field: ["metafields", "0"], message: "Value is invalid" }] } });
    await expect(createCustomerGateway(a).writeClaimMetafields(input)).rejects.toThrow(/metafieldsSet failed.*invalid/);
  });
});

describe("customer gateway: tag", () => {
  it("adds only the claim tag, never replacing existing tags", async () => {
    const a = admin("SUBSCRIBED");
    await createCustomerGateway(a).addClaimTag({ customerId: ID });
    const [[, { variables }]] = calls(a, ADD_TAGS);
    expect(variables).toEqual({ id: ID, tags: ["trekiva_welcome_claimed"] });
    // tagsAdd, not customerUpdate: nothing else on the customer is rewritten.
    expect(a.graphql.mock.calls.map(([q]) => q)).toEqual([ADD_TAGS]);
  });

  it("treats userErrors as a failure", async () => {
    const a = admin("SUBSCRIBED", { userErrors: { tags: [{ field: ["id"], message: "Customer not found" }] } });
    await expect(createCustomerGateway(a).addClaimTag({ customerId: ID })).rejects.toThrow(/tagsAdd failed/);
  });

  it("with restart, removes ONLY our tag first and then adds it again", async () => {
    const a = admin("SUBSCRIBED");
    await createCustomerGateway(a).addClaimTag({ customerId: ID, restart: true });
    expect(a.graphql.mock.calls.map(([q]) => q)).toEqual([REMOVE_TAGS, ADD_TAGS]);
    expect(calls(a, REMOVE_TAGS)[0][1].variables).toEqual({ id: ID, tags: ["trekiva_welcome_claimed"] });
    expect(calls(a, ADD_TAGS)[0][1].variables).toEqual({ id: ID, tags: ["trekiva_welcome_claimed"] });
  });

  it("does not add the tag if removing it failed, so the claim fails and is retried", async () => {
    const a = admin("SUBSCRIBED", { userErrors: { remove: [{ field: ["id"], message: "nope" }] } });
    await expect(createCustomerGateway(a).addClaimTag({ customerId: ID, restart: true })).rejects.toThrow(/tagsRemove failed/);
    expect(calls(a, ADD_TAGS)).toHaveLength(0);
  });
});

describe("unsubscribeCustomer", () => {
  it("marks the customer UNSUBSCRIBED in Shopify, the single record of consent", async () => {
    const a = admin("SUBSCRIBED");
    await unsubscribeCustomer(a, ID);
    const [[, { variables }]] = calls(a, SUBSCRIBE_CUSTOMER);
    expect(variables.input.customerId).toBe(ID);
    expect(variables.input.emailMarketingConsent.marketingState).toBe("UNSUBSCRIBED");
  });
});
