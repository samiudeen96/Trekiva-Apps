import { describe, expect, it, vi } from "vitest";
import { CREATE_CUSTOMER, FIND_CUSTOMER, SUBSCRIBE_CUSTOMER, createCustomerGateway } from "./customers.server";

const ID = "gid://shopify/Customer/1";

function admin(marketingState: string | null) {
  return {
    graphql: vi.fn(async (query: string) => {
      if (query === FIND_CUSTOMER) {
        const nodes = marketingState ? [{ id: ID, defaultEmailAddress: { marketingState } }] : [];
        return Response.json({ data: { customers: { nodes } } });
      }
      if (query === SUBSCRIBE_CUSTOMER) {
        return Response.json({ data: { customerEmailMarketingConsentUpdate: { customer: { id: ID }, userErrors: [] } } });
      }
      if (query === CREATE_CUSTOMER) {
        return Response.json({ data: { customerCreate: { customer: { id: ID }, userErrors: [] } } });
      }
      throw new Error("unexpected query");
    }),
  };
}

const calls = (a: ReturnType<typeof admin>, q: string) => a.graphql.mock.calls.filter(([x]) => x === q);

describe("customer gateway consent", () => {
  it("creates new customers as subscribed", async () => {
    const a = admin(null);
    expect(await createCustomerGateway(a).findOrCreate({ email: "a@b.co" })).toEqual({ id: ID, subscribed: true });
    expect(calls(a, CREATE_CUSTOMER)).toHaveLength(1);
  });

  it("subscribes an existing customer who never chose", async () => {
    const a = admin("NOT_SUBSCRIBED");
    expect(await createCustomerGateway(a).findOrCreate({ email: "a@b.co" })).toEqual({ id: ID, subscribed: true });
    const [[, opts]] = calls(a, SUBSCRIBE_CUSTOMER) as unknown as [[string, { variables: { input: Record<string, unknown> } }]];
    expect(opts.variables.input).toMatchObject({
      customerId: ID,
      emailMarketingConsent: { marketingState: "SUBSCRIBED", marketingOptInLevel: "SINGLE_OPT_IN" },
    });
  });

  it("leaves subscribed customers untouched", async () => {
    const a = admin("SUBSCRIBED");
    expect(await createCustomerGateway(a).findOrCreate({ email: "a@b.co" })).toEqual({ id: ID, subscribed: true });
    expect(calls(a, SUBSCRIBE_CUSTOMER)).toHaveLength(0);
  });

  it.each(["UNSUBSCRIBED", "PENDING", "INVALID"])("never overrides %s", async (state) => {
    const a = admin(state);
    expect(await createCustomerGateway(a).findOrCreate({ email: "a@b.co" })).toEqual({ id: ID, subscribed: false });
    expect(calls(a, SUBSCRIBE_CUSTOMER)).toHaveLength(0);
  });
});
