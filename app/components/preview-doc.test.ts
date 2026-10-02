import { describe, expect, it } from "vitest";
import { defaultCampaign } from "../campaigns/defaults";
import { buildPreviewDoc } from "./preview-doc";

describe("buildPreviewDoc", () => {
  it("inlines the real popup assets and forces the load trigger", () => {
    const doc = buildPreviewDoc({
      ...defaultCampaign,
      content: { ...defaultCampaign.content, title: "</script><b>x</b>" },
    });
    expect(doc).toContain("tkv-overlay");
    expect(doc).toContain('"trigger":"load"');
    // campaign copy can not break out of the config <script>
    expect(doc.match(/<\/script>/g)).toHaveLength(2);
  });
});
