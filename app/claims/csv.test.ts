import { describe, expect, it } from "vitest";
import { csvCell, csvRow } from "./csv";

describe("csv", () => {
  it("quotes and escapes", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvRow(["x", null, "y\nz"])).toBe('x,,"y\nz"\r\n');
  });
  it("neutralises formula injection", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell("@x")).toBe("'@x");
    expect(csvCell("plain@example.com")).toBe("plain@example.com");
  });
});
