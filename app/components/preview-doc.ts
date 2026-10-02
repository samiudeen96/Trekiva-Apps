// The preview runs the REAL storefront popup (same CSS + JS the theme extension ships)
// inside a sandboxed iframe, with fetch stubbed so nothing is sent anywhere.
import popupCss from "../../extensions/trekiva-popup/assets/trekiva-popup.css?raw";
import popupJs from "../../extensions/trekiva-popup/assets/trekiva-popup.js?raw";
import type { CampaignInput } from "../campaigns/schema";

/** Safe to embed inside <script>: no "</script>" or HTML comment sequences. */
const embed = (v: unknown) =>
  JSON.stringify(v)
    .split("<").join("\\u003c")
    .split("\u2028").join("\\u2028")
    .split("\u2029").join("\\u2029");

export function buildPreviewDoc(input: CampaignInput): string {
  const config = {
    id: "preview",
    template: input.details.template,
    content: input.content,
    design: input.design,
    rules: { ...input.rules, trigger: "load" },
  };

  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;height:100%;font-family:system-ui,-apple-system,sans-serif;background:#f1f1f1}</style>
<style>${popupCss}</style></head><body>
<div id="trekiva-popup-root" data-proxy-base="/apps/trekiva" data-page-type="index" data-design-mode="true" hidden></div>
<script>
(function () {
  var CONFIG = ${embed(config)};
  var seen = {};
  function json(body, status) {
    return Promise.resolve(new Response(JSON.stringify(body), { status: status || 200, headers: { "Content-Type": "application/json" } }));
  }
  window.fetch = function (url, opts) {
    if (/\\/campaigns\\/active$/.test(url)) return json({ campaign: CONFIG });
    if (/\\/claim$/.test(url)) {
      var email = String(JSON.parse(opts.body).email).trim().toLowerCase();
      if (seen[email]) return json({ status: "already_claimed", message: CONFIG.content.alreadyClaimedMessage });
      seen[email] = 1;
      return json({ status: "claimed", message: CONFIG.content.successMessage });
    }
    return json({}, 404);
  };
})();
</script>
<script>${popupJs.replace(/<\/script/gi, "<\\/script")}</script>
</body></html>`;
}
