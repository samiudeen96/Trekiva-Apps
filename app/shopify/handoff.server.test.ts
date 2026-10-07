import { describe, expect, it, vi } from "vitest";
import {
  CREATE_DEFINITION,
  CUSTOMER_TAGS,
  LIST_DEFINITIONS,
  ensureMetafieldDefinitions,
  hasEmailSentTag,
  missingMetafieldDefinitions,
} from "./handoff.server";
import { CLAIM_METAFIELDS } from "../claims/handoff";

type Existing = { key: string; type: { name: string } };
const all: Existing[] = CLAIM_METAFIELDS.map((m) => ({ key: m.key, type: { name: m.type } }));

function admin(existing: Existing[], createErrors: Record<string, string> = {}, tags: string[] = []) {
  return {
    graphql: vi.fn(async (query: string, opts?: { variables?: Record<string, any> }) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      if (query === LIST_DEFINITIONS) return Response.json({ data: { metafieldDefinitions: { nodes: existing } } });
      if (query === CREATE_DEFINITION) {
        const key = opts!.variables!.definition.key as string;
        const msg = createErrors[key];
        return Response.json({
          data: { metafieldDefinitionCreate: { createdDefinition: msg ? null : { id: "1" }, userErrors: msg ? [{ message: msg }] : [] } },
        });
      }
      if (query === CUSTOMER_TAGS) return Response.json({ data: { customer: { tags } } });
      throw new Error("unexpected query");
    }),
  };
}

describe("metafield definitions", () => {
  it("reports nothing missing when every definition exists with the right type", async () => {
    expect(await missingMetafieldDefinitions(admin(all))).toEqual([]);
  });

  it("reports missing definitions and ones with the wrong type", async () => {
    const some = all.filter((d) => d.key !== "welcome_claim_id").map((d) => (d.key === "welcome_offer_claimed" ? { ...d, type: { name: "single_line_text_field" } } : d));
    expect((await missingMetafieldDefinitions(admin(some))).sort()).toEqual(["welcome_claim_id", "welcome_offer_claimed"]);
  });

  it("creates only the missing ones, on the customer, in the trekiva namespace", async () => {
    const a = admin(all.filter((d) => d.key !== "welcome_claimed_at"));
    expect(await ensureMetafieldDefinitions(a)).toEqual({ created: ["welcome_claimed_at"], failed: [] });
    const creates = a.graphql.mock.calls.filter(([q]) => q === CREATE_DEFINITION) as unknown as [string, { variables: { definition: object } }][];
    expect(creates).toHaveLength(1);
    expect(creates[0][1].variables.definition).toMatchObject({
      namespace: "trekiva",
      key: "welcome_claimed_at",
      type: "date_time",
      ownerType: "CUSTOMER",
    });
  });

  it("is a no-op when everything exists, and reports failures without throwing", async () => {
    const full = admin(all);
    expect(await ensureMetafieldDefinitions(full)).toEqual({ created: [], failed: [] });
    expect(full.graphql.mock.calls.filter(([q]) => q === CREATE_DEFINITION)).toHaveLength(0);

    const bad = await ensureMetafieldDefinitions(admin([], { welcome_claim_id: "Key is in use" }));
    expect(bad.failed).toEqual([{ key: "welcome_claim_id", message: "Key is in use" }]);
    expect(bad.created).toHaveLength(CLAIM_METAFIELDS.length - 1);
  });
});

describe("hasEmailSentTag", () => {
  it("detects the Flow completion tag case-insensitively", async () => {
    expect(await hasEmailSentTag(admin([], {}, ["VIP", "Trekiva_Welcome_Email_Sent"]), "gid://shopify/Customer/1")).toBe(true);
  });

  it("is false for the trigger tag alone, or no customer", async () => {
    expect(await hasEmailSentTag(admin([], {}, ["trekiva_welcome_claimed"]), "gid://shopify/Customer/1")).toBe(false);
    const none = { graphql: vi.fn(async () => Response.json({ data: { customer: null } })) };
    expect(await hasEmailSentTag(none, "gid://shopify/Customer/1")).toBe(false);
  });
});
