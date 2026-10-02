import { describe, expect, it, vi } from "vitest";
import { createFlowGateway, FLOW_TRIGGER_HANDLE } from "./flow.server";

const input = {
  shopDomain: "s.myshopify.com",
  email: "a@b.co",
  campaignName: "Welcome 10% Popup",
  discountCode: "WELCOME10",
  claimedAt: new Date("2026-10-02T10:00:00Z"),
  customerId: "gid://shopify/Customer/123",
};
const admin = (body: object) => ({
  graphql: vi.fn(async () => Response.json(body)),
});

describe("flow gateway", () => {
  it("sends the trigger payload matching the extension fields", async () => {
    const a = admin({ data: { flowTriggerReceive: { userErrors: [] } } });
    await createFlowGateway(a).triggerWelcomeOfferClaimed(input);
    const [, opts] = a.graphql.mock.calls[0] as unknown as [string, { variables: any }];
    expect(opts.variables).toEqual({
      handle: FLOW_TRIGGER_HANDLE,
      payload: {
        customer_id: 123,
        CustomerEmail: "a@b.co",
        CampaignName: "Welcome 10% Popup",
        DiscountCode: "WELCOME10",
        ClaimedAt: "2026-10-02T10:00:00.000Z",
      },
    });
  });

  it("throws on userErrors so the claim is marked FAILED", async () => {
    const a = admin({ data: { flowTriggerReceive: { userErrors: [{ message: "bad" }] } } });
    await expect(createFlowGateway(a).triggerWelcomeOfferClaimed(input)).rejects.toThrow();
  });
});
