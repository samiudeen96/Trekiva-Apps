// Pure (no server imports). A small, safe markup instead of HTML, so rich text can never carry a script,
// an event handler or an unsafe link into an email:
//   **bold**   *italic*   [label](https://link)   [label]({{discount_link}})   lines starting "- " = a list

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

const BOLD = /\*\*(?=\S)(.+?)(?<=\S)\*\*/g;
const ITALIC = /(?<![*\w])\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?![*\w])/g;
// The url may not contain a quote, a bracket, a parenthesis, a space or an asterisk.
const LINK = /\[([^\]\n]+)\]\((https:\/\/[^\s()*[\]]+|\{\{discount_link\}\}|\{\{shop_url\}\})\)/g;

export interface RichContext {
  /** Resolves {{discount_link}} / {{shop_url}} to a real https url. */
  link: (placeholder: "{{discount_link}}" | "{{shop_url}}") => string;
  /** Fills {{code}} etc. into already-formatted, already-escaped html. Values are inserted last. */
  fill: (escapedHtml: string) => string;
}

/** Formats one escaped line: bold, italic, links. Unknown or unsafe syntax is left as literal text. */
function inline(escaped: string, ctx: RichContext): string {
  return escaped
    .replace(BOLD, "<strong>$1</strong>")
    .replace(ITALIC, "<em>$1</em>")
    .replace(LINK, (_m, label: string, url: string) => {
      const href = url.startsWith("{{") ? ctx.link(url as "{{discount_link}}" | "{{shop_url}}") : url;
      return `<a href="${href}" style="color:inherit;text-decoration:underline;">${label}</a>`;
    });
}

const BULLET = /^[-•]\s+\S/;

/** Formats a whole field into html blocks (paragraphs and lists), each with the given inline style. */
export function renderRich(src: string, ctx: RichContext, style: string): string {
  const out: string[] = [];
  for (const block of src.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)) {
    // Within a block, consecutive "- " lines form a list and the lines around them form paragraphs.
    const runs: { list: boolean; lines: string[] }[] = [];
    for (const line of block.split("\n").map((l) => l.trim())) {
      const list = BULLET.test(line);
      const last = runs[runs.length - 1];
      if (last && last.list === list) last.lines.push(line);
      else runs.push({ list, lines: [line] });
    }
    for (const run of runs) {
      if (run.list) {
        const items = run.lines.map((l) => `<li style="margin:0 0 4px;">${ctx.fill(inline(esc(l.replace(/^[-•]\s+/, "")), ctx))}</li>`);
        out.push(`<ul style="${style}padding-left:22px;text-align:left;">${items.join("")}</ul>`);
      } else {
        out.push(`<p style="${style}">${run.lines.map((l) => ctx.fill(inline(esc(l), ctx))).join("<br>")}</p>`);
      }
    }
  }
  return out.join("");
}

/** The plain-text version of a rich field: the markers removed, links written out. */
export function stripRich(src: string, link: (p: "{{discount_link}}" | "{{shop_url}}") => string): string {
  return src
    .replace(LINK, (_m, label: string, url: string) => `${label} (${url.startsWith("{{") ? link(url as "{{discount_link}}" | "{{shop_url}}") : url})`)
    .replace(BOLD, "$1")
    .replace(ITALIC, "$1")
    .replace(/^[-•]\s+/gm, "• ");
}
