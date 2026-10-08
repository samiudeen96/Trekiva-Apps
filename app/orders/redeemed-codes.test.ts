import { describe, expect, it } from "vitest";
import { redeemedCodeCandidates } from "./redeemed-codes";

describe("redeemedCodeCandidates", () => {
  it("reads a code Shopify redeemed normally", () => {
    expect(redeemedCodeCandidates({ discount_codes: [{ code: "WELCOME10-7KQ2M9XH" }] })).toEqual([
      "WELCOME10-7KQ2M9XH",
    ]);
  });

  it("reads a code a checkout app left only in its note attributes", () => {
    // The real shape COD King writes: the amount it worked out, then the code.
    const found = redeemedCodeCandidates({
      discount_codes: [],
      note_attributes: [
        { name: "_codkDiscounts", value: "orderLevel:99.9|WELCOME10-TS73UDMA" },
        { name: "_codkSessionId", value: "82a509de-590d-4f3a-90f9-508465176a63" },
      ],
    });
    expect(found).toContain("WELCOME10-TS73UDMA");
  });

  it("reads a custom order-level discount, which has a title but no code", () => {
    expect(
      redeemedCodeCandidates({ discount_applications: [{ title: "WELCOME10-TS73UDMA" }] }),
    ).toEqual(["WELCOME10-TS73UDMA"]);
  });

  it("normalises case and never repeats a code", () => {
    expect(
      redeemedCodeCandidates({
        discount_codes: [{ code: "welcome10-abc12345" }],
        discount_applications: [{ code: "WELCOME10-ABC12345", title: "WELCOME10-ABC12345" }],
      }),
    ).toEqual(["WELCOME10-ABC12345"]);
  });

  it("ignores values that cannot be a code", () => {
    const found = redeemedCodeCandidates({
      discount_codes: [{ code: "" }, { code: null }, { code: 42 }],
      note_attributes: [
        { name: "_codkAmountValue", value: "0.0" },
        { name: "_codkImageURLs", value: "https://cdn.shopify.com/s/files/1/0757/x.webp" },
        { name: "lowercase", value: "not a code" },
        { name: "_codkCheckoutMode", value: "cod_only" },
      ],
    });
    expect(found).toEqual([]);
  });

  it("survives a payload with nothing in it", () => {
    expect(redeemedCodeCandidates(null)).toEqual([]);
    expect(redeemedCodeCandidates({})).toEqual([]);
    expect(redeemedCodeCandidates({ discount_codes: null, note_attributes: null })).toEqual([]);
  });
});
