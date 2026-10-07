import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { renderEmail } from "../email/render";
import { newSection, SECTION_LABELS } from "../email/defaults";
import { EMAIL_PLACEHOLDERS, type EmailSection, type EmailSectionType, type EmailTemplate } from "../email/schema";
import type { RenderedEmail } from "../email/render";

const SAMPLE_CODE = "WELCOME10-7KQ2M9XH";

const box: CSSProperties = { border: "1px solid #e3e3e3", borderRadius: 8, padding: 12, background: "#fff" };
const input: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "8px 10px",
  fontSize: 14,
  fontFamily: "inherit",
  border: "1px solid #8a8a8a",
  borderRadius: 6,
  background: "#fff",
  color: "inherit",
};
const small: CSSProperties = { fontSize: 12, color: "#616161", margin: "4px 0 0" };
const btn: CSSProperties = { padding: "6px 10px", fontSize: 13, borderRadius: 6, border: "1px solid #8a8a8a", background: "#fff", cursor: "pointer", color: "inherit" };

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label style={{ display: "block", marginBottom: 10 }}>
      <span style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{label}</span>
      {children}
      {hint && <p style={small}>{hint}</p>}
    </label>
  );
}

const urlProblem = (v: string, allowPlaceholders: boolean) =>
  v === "" || /^https:\/\//i.test(v) || (allowPlaceholders && (v === "{{discount_link}}" || v === "{{shop_url}}"))
    ? null
    : allowPlaceholders ? "Use an https URL, {{discount_link}} or {{shop_url}}" : "Use an https URL";

function Text(props: { label: string; value: string; max: number; onChange: (v: string) => void; hint?: string; url?: "plain" | "link"; area?: boolean }) {
  const problem = props.url ? urlProblem(props.value, props.url === "link") : null;
  return (
    <Field label={props.label} hint={problem ?? props.hint}>
      {props.area ? (
        <textarea style={{ ...input, minHeight: 90, resize: "vertical" }} maxLength={props.max} value={props.value} onChange={(e) => props.onChange(e.target.value)} />
      ) : (
        <input style={{ ...input, ...(problem ? { borderColor: "#d92d20" } : {}) }} maxLength={props.max} value={props.value} onChange={(e) => props.onChange(e.target.value)} />
      )}
    </Field>
  );
}

function Pick<T extends string>(props: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <Field label={props.label}>
      <select style={input} value={props.value} onChange={(e) => props.onChange(e.target.value as T)}>
        {props.options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
    </Field>
  );
}

function Color(props: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={props.label}>
      <input type="color" value={props.value} onChange={(e) => props.onChange(e.target.value)} style={{ width: 56, height: 34, padding: 2, border: "1px solid #8a8a8a", borderRadius: 6, background: "#fff" }} />
    </Field>
  );
}

const ALIGN: ["left" | "center" | "right", string][] = [["left", "Left"], ["center", "Center"], ["right", "Right"]];

function SectionFields({ s, set }: { s: EmailSection; set: (s: EmailSection) => void }) {
  switch (s.type) {
    case "header":
      return (
        <>
          <Text label="Logo image URL" value={s.logoUrl} max={2048} url="plain" hint="https, JPG or PNG (Outlook cannot show WebP). Empty shows your store name." onChange={(logoUrl) => set({ ...s, logoUrl })} />
          <Field label="Logo width (px)">
            <input type="number" style={input} min={40} max={400} value={s.logoWidth} onChange={(e) => set({ ...s, logoWidth: Number(e.target.value) || 160 })} />
          </Field>
          <Pick label="Alignment" value={s.align} options={ALIGN} onChange={(align) => set({ ...s, align })} />
          <Color label="Background" value={s.backgroundColor} onChange={(backgroundColor) => set({ ...s, backgroundColor })} />
        </>
      );
    case "text":
      return (
        <>
          <Text label="Heading" value={s.heading} max={120} onChange={(heading) => set({ ...s, heading })} />
          <Text label="Text" area value={s.body} max={2000} hint="Leave a blank line between paragraphs." onChange={(body) => set({ ...s, body })} />
          <Pick label="Alignment" value={s.align} options={ALIGN} onChange={(align) => set({ ...s, align })} />
        </>
      );
    case "image":
      return (
        <>
          <Text label="Image URL" value={s.imageUrl} max={2048} url="plain" hint="https, JPG or PNG." onChange={(imageUrl) => set({ ...s, imageUrl })} />
          <Text label="Alt text" value={s.alt} max={120} hint="Shown when images are blocked." onChange={(alt) => set({ ...s, alt })} />
          <Text label="Link (optional)" value={s.linkUrl} max={2048} url="link" onChange={(linkUrl) => set({ ...s, linkUrl })} />
        </>
      );
    case "imageText":
      return (
        <>
          <Text label="Image URL" value={s.imageUrl} max={2048} url="plain" onChange={(imageUrl) => set({ ...s, imageUrl })} />
          <Text label="Alt text" value={s.alt} max={120} onChange={(alt) => set({ ...s, alt })} />
          <Text label="Heading" value={s.heading} max={120} onChange={(heading) => set({ ...s, heading })} />
          <Text label="Text" area value={s.body} max={600} onChange={(body) => set({ ...s, body })} />
          <Text label="Button label" value={s.buttonLabel} max={40} onChange={(buttonLabel) => set({ ...s, buttonLabel })} />
          <Text label="Button link" value={s.buttonUrl} max={2048} url="link" hint="{{discount_link}} applies the customer's code." onChange={(buttonUrl) => set({ ...s, buttonUrl })} />
          <Pick label="Image position" value={s.imagePosition} options={[["left", "Left"], ["right", "Right"]]} onChange={(imagePosition) => set({ ...s, imagePosition })} />
        </>
      );
    case "discount":
      return (
        <>
          <p style={{ ...small, marginBottom: 10 }}>Shows the customer&apos;s own code in a box they can copy, plus a button that applies it for them.</p>
          <Text label="Heading" value={s.heading} max={120} onChange={(heading) => set({ ...s, heading })} />
          <Text label="Description" area value={s.description} max={400} onChange={(description) => set({ ...s, description })} />
          <Text label="Button label" value={s.buttonLabel} max={40} hint="Empty hides the button." onChange={(buttonLabel) => set({ ...s, buttonLabel })} />
          <Text label="After applying, send them to" value={s.redirectPath} max={200} hint='A store path such as /collections/sandals. Empty = home page.' onChange={(redirectPath) => set({ ...s, redirectPath })} />
          <Text label="Conditions / expiry note" value={s.note} max={300} hint="e.g. Valid on your first order. Expires in 30 days." onChange={(note) => set({ ...s, note })} />
        </>
      );
    case "button":
      return (
        <>
          <Text label="Label" value={s.label} max={40} onChange={(label) => set({ ...s, label })} />
          <Text label="Link" value={s.url} max={2048} url="link" hint="{{discount_link}} applies the customer's code." onChange={(url) => set({ ...s, url })} />
          <Pick label="Alignment" value={s.align} options={ALIGN} onChange={(align) => set({ ...s, align })} />
        </>
      );
    case "columns":
      return (
        <>
          {s.items.map((item, i) => (
            <div key={i} style={{ ...box, marginBottom: 8, background: "#fafafa" }}>
              <Text label={`Column ${i + 1} title`} value={item.title} max={60} onChange={(title) => set({ ...s, items: s.items.map((x, j) => (j === i ? { ...x, title } : x)) })} />
              <Text label={`Column ${i + 1} text`} value={item.text} max={200} onChange={(text) => set({ ...s, items: s.items.map((x, j) => (j === i ? { ...x, text } : x)) })} />
            </div>
          ))}
          <div style={{ display: "flex", gap: 8 }}>
            {s.items.length < 3 && (
              <button type="button" style={btn} onClick={() => set({ ...s, items: [...s.items, { title: "Title", text: "Text" }] })}>Add column</button>
            )}
            {s.items.length > 2 && (
              <button type="button" style={btn} onClick={() => set({ ...s, items: s.items.slice(0, -1) })}>Remove last column</button>
            )}
          </div>
        </>
      );
  }
}

function summary(s: EmailSection): string {
  switch (s.type) {
    case "text":
    case "imageText":
      return s.heading;
    case "discount":
      return s.heading;
    case "button":
      return s.label;
    default:
      return "";
  }
}

// The "Add section" menu, grouped like Shopify Messaging.
const ADD_GROUPS: { label: string; types: EmailSectionType[] }[] = [
  { label: "Elements", types: ["text", "button", "image"] },
  { label: "Offer", types: ["discount"] },
  { label: "Layout", types: ["imageText", "columns", "header"] },
];

const panelTitle: CSSProperties = { margin: 0, fontSize: 14, fontWeight: 650 };
const group: CSSProperties = { borderTop: "1px solid #ebebeb", padding: "14px 16px" };
const groupTitle: CSSProperties = { margin: "0 0 10px", fontSize: 13, fontWeight: 650 };

export interface TemplateEditorProps {
  name: string;
  onNameChange: (name: string) => void;
  value: EmailTemplate;
  onChange: (t: EmailTemplate) => void;
  /** Sender shown in Email details, e.g. "Trekiva <care@trekiva.com>". Null when sending is not set up. */
  from: string | null;
  /** Shown where the email says {{shop_name}}. */
  shopName: string;
  onSendTest: (to: string) => void;
  sendingTest: boolean;
  testResult?: { ok: boolean; message: string } | null;
}

export function TemplateEditor(p: TemplateEditorProps) {
  const { value, onChange } = p;
  const [selected, setSelected] = useState<string | null>(null);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [adding, setAdding] = useState(false);
  const [to, setTo] = useState("");
  const scrollY = useRef(0);
  const frame = useRef<HTMLIFrameElement>(null);

  const section = value.sections.find((s) => s.id === selected) ?? null;
  const index = section ? value.sections.indexOf(section) : -1;
  const discounts = value.sections.filter((s) => s.type === "discount").length;
  const full = value.sections.length >= 20;

  const setSections = (sections: EmailSection[]) => onChange({ ...value, sections });
  const setBrand = (patch: Partial<EmailTemplate["brand"]>) => onChange({ ...value, brand: { ...value.brand, ...patch } });
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= value.sections.length) return;
    const next = [...value.sections];
    [next[i], next[j]] = [next[j], next[i]];
    setSections(next);
  };
  const duplicate = (s: EmailSection) => {
    if (full) return;
    const copy = { ...structuredClone(s), id: newSection(s.type).id } as EmailSection;
    const next = [...value.sections];
    next.splice(value.sections.indexOf(s) + 1, 0, copy);
    setSections(next);
    setSelected(copy.id);
  };
  const remove = (s: EmailSection) => {
    setSections(value.sections.filter((x) => x.id !== s.id));
    setSelected(null);
  };
  const add = (type: EmailSectionType) => {
    const s = newSection(type);
    const next = [...value.sections];
    // Inserted after the selected section, like Messaging; otherwise at the end.
    next.splice(index >= 0 ? index + 1 : next.length, 0, s);
    setSections(next);
    setSelected(s.id);
    setAdding(false);
  };
  const cannotDelete = (s: EmailSection) =>
    value.sections.length === 1 || (s.type === "discount" && discounts === 1)
      ? "Keep at least one discount section: it shows the customer's code"
      : null;

  // Clicks inside the canvas select a section (the preview posts the section id back).
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || !e.data || typeof e.data !== "object") return;
      if ("trekivaScroll" in e.data) scrollY.current = Number(e.data.trekivaScroll) || 0;
      if ("trekivaSection" in e.data) {
        setSelected(typeof e.data.trekivaSection === "string" ? e.data.trekivaSection : null);
        setAdding(false);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const [html, setHtml] = useState(() => build(value, p.shopName, null, 0));
  useEffect(() => {
    const t = setTimeout(() => setHtml(build(value, p.shopName, selected, scrollY.current)), 200);
    return () => clearTimeout(t);
  }, [value, p.shopName, selected]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 320px) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
      {/* Left: settings for the whole email, or for the selected section. */}
      <aside style={{ ...box, padding: 0, position: "sticky", top: 12, maxHeight: "calc(100vh - 24px)", overflowY: "auto" }}>
        {section ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 16px" }}>
              <button type="button" style={{ ...btn, padding: "4px 8px" }} aria-label="Back to email settings" onClick={() => setSelected(null)}>
                ←
              </button>
              <h3 style={panelTitle}>{SECTION_LABELS[section.type]}</h3>
            </div>
            <div style={group}>
              <SectionFields s={section} set={(next) => setSections(value.sections.map((x) => (x.id === section.id ? next : x)))} />
            </div>
            <div style={group}>
              <p style={groupTitle}>Arrange</p>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button type="button" style={btn} disabled={index === 0} onClick={() => move(index, -1)}>Move up</button>
                <button type="button" style={btn} disabled={index === value.sections.length - 1} onClick={() => move(index, 1)}>Move down</button>
                <button type="button" style={btn} disabled={full} onClick={() => duplicate(section)}>Duplicate</button>
                <button
                  type="button"
                  style={{ ...btn, color: cannotDelete(section) ? undefined : "#d92d20" }}
                  disabled={Boolean(cannotDelete(section))}
                  title={cannotDelete(section) ?? undefined}
                  onClick={() => remove(section)}
                >
                  Delete
                </button>
              </div>
              {cannotDelete(section) && <p style={small}>{cannotDelete(section)}</p>}
            </div>
          </>
        ) : (
          <>
            <div style={{ padding: "14px 16px" }}>
              <h3 style={panelTitle}>Email</h3>
              <p style={small}>Click a section in the email to edit it.</p>
            </div>
            <div style={group}>
              <Text label="Template name" value={p.name} max={80} hint="Only you see this. Campaigns pick templates by name." onChange={p.onNameChange} />
            </div>
            <div style={group}>
              <p style={groupTitle}>Sections</p>
              <div style={{ display: "grid", gap: 4 }}>
                {value.sections.map((s, i) => (
                  <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <button type="button" style={{ ...btn, flex: 1, textAlign: "left", border: "1px solid #e3e3e3" }} onClick={() => setSelected(s.id)}>
                      {SECTION_LABELS[s.type]}
                      {summary(s) && <span style={{ color: "#616161" }}> · {summary(s).slice(0, 22)}</span>}
                    </button>
                    <button type="button" style={{ ...btn, padding: "6px 8px" }} aria-label={`Move ${SECTION_LABELS[s.type]} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                    <button type="button" style={{ ...btn, padding: "6px 8px" }} aria-label={`Move ${SECTION_LABELS[s.type]} down`} disabled={i === value.sections.length - 1} onClick={() => move(i, 1)}>↓</button>
                  </div>
                ))}
              </div>
            </div>
            <div style={group}>
              <p style={groupTitle}>Email colors</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                <Color label="Page background" value={value.brand.backgroundColor} onChange={(backgroundColor) => setBrand({ backgroundColor })} />
                <Color label="Content background" value={value.brand.contentBackgroundColor} onChange={(contentBackgroundColor) => setBrand({ contentBackgroundColor })} />
                <Color label="Text" value={value.brand.textColor} onChange={(textColor) => setBrand({ textColor })} />
                <Color label="Button / code box" value={value.brand.buttonColor} onChange={(buttonColor) => setBrand({ buttonColor })} />
                <Color label="Button text" value={value.brand.buttonTextColor} onChange={(buttonTextColor) => setBrand({ buttonTextColor })} />
              </div>
            </div>
            <div style={group}>
              <p style={groupTitle}>Style</p>
              <Pick label="Font" value={value.brand.fontFamily} options={[["sans", "Sans-serif"], ["serif", "Serif"]]} onChange={(fontFamily) => setBrand({ fontFamily })} />
              <Field label="Content width (px)">
                <input type="number" style={input} min={480} max={680} value={value.brand.width} onChange={(e) => setBrand({ width: Number(e.target.value) || 600 })} />
              </Field>
            </div>
            <div style={group}>
              <p style={groupTitle}>Footer</p>
              <Text label="Sender details" area value={value.footer.address} max={300} hint="Business name and postal address. The unsubscribe link is always added and cannot be removed." onChange={(address) => onChange({ ...value, footer: { address } })} />
            </div>
          </>
        )}
      </aside>

      {/* Right: email details and the live canvas. */}
      <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
        <div style={box}>
          <p style={{ ...groupTitle, marginBottom: 12 }}>Email details</p>
          <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: "4px 12px", alignItems: "center", fontSize: 13 }}>
            <span style={{ color: "#616161" }}>To</span>
            <span>The customer who claimed (subscribers get this email; others get only their code)</span>
            <span style={{ color: "#616161" }}>From</span>
            <span>{p.from ?? "Not set up yet: set EMAIL_FROM (see Settings)"}</span>
          </div>
          <div style={{ marginTop: 12 }}>
            <Text label="Subject" value={value.subject} max={150} onChange={(subject) => onChange({ ...value, subject })} />
            <Text label="Preview text" value={value.previewText} max={150} hint="The grey line after the subject in the inbox." onChange={(previewText) => onChange({ ...value, previewText })} />
          </div>
          <p style={small}>
            Use {EMAIL_PLACEHOLDERS.map((x) => x.token).join(", ")} anywhere. {EMAIL_PLACEHOLDERS.map((x) => `${x.token}: ${x.help}`).join(". ")}.
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 4 }}>
            <button type="button" aria-pressed={device === "desktop"} style={{ ...btn, ...(device === "desktop" ? { background: "#1a1a1a", color: "#fff" } : {}) }} onClick={() => setDevice("desktop")}>Desktop</button>
            <button type="button" aria-pressed={device === "mobile"} style={{ ...btn, ...(device === "mobile" ? { background: "#1a1a1a", color: "#fff" } : {}) }} onClick={() => setDevice("mobile")}>Mobile</button>
          </div>
          <div style={{ flex: 1 }} />
          <input type="email" aria-label="Send a test to" style={{ ...input, width: 220 }} placeholder="you@example.com" value={to} onChange={(e) => setTo(e.target.value)} />
          <button type="button" style={btn} disabled={!p.from || !to || p.sendingTest} onClick={() => p.onSendTest(to)}>
            {p.sendingTest ? "Sending…" : "Send test"}
          </button>
        </div>
        {p.testResult && <p style={{ ...small, margin: 0, color: p.testResult.ok ? "#047b5d" : "#d92d20" }}>{p.testResult.message}</p>}

        <div style={{ display: "flex", justifyContent: "center", background: "#e3e3e3", borderRadius: 8, padding: 12 }}>
          <iframe
            ref={frame}
            title="Email canvas: click a section to edit it"
            // Scripts only: the preview runs with an opaque origin and cannot reach this page.
            sandbox="allow-scripts"
            srcDoc={html}
            style={{ width: device === "mobile" ? 375 : "100%", maxWidth: "100%", height: 720, border: 0, borderRadius: 6, background: "#fff" }}
          />
        </div>

        <div style={{ position: "relative" }}>
          <button type="button" style={{ ...btn, background: "#2c6ecb", color: "#fff", borderColor: "#2c6ecb" }} disabled={full} aria-expanded={adding} onClick={() => setAdding((a) => !a)}>
            + Add section{section ? ` after ${SECTION_LABELS[section.type]}` : ""}
          </button>
          {full && <span style={{ ...small, marginLeft: 8 }}>20 sections is the maximum.</span>}
          {adding && (
            <div role="menu" style={{ ...box, position: "absolute", bottom: "calc(100% + 6px)", left: 0, width: 240, zIndex: 5, boxShadow: "0 6px 20px rgba(0,0,0,.15)", padding: 8 }}>
              {ADD_GROUPS.map((g) => (
                <div key={g.label} style={{ marginBottom: 6 }}>
                  <p style={{ ...small, margin: "4px 6px", fontWeight: 600 }}>{g.label}</p>
                  {g.types.map((t) => (
                    <button key={t} type="button" role="menuitem" style={{ ...btn, border: 0, width: "100%", textAlign: "left" }} onClick={() => add(t)}>
                      {SECTION_LABELS[t]}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const SAMPLE_VARS = (shopName: string) => ({
  code: SAMPLE_CODE,
  discountBase: `https://example.myshopify.com/discount/${SAMPLE_CODE}`,
  shopName,
  shopUrl: "https://example.myshopify.com/",
  firstName: null,
  unsubscribeUrl: "#",
});

function build(t: EmailTemplate, shopName: string, selectedId: string | null, scrollY: number): string {
  return renderEmail({ template: t, vars: SAMPLE_VARS(shopName), preview: { selectedId, scrollY } }).html;
}

/** Read-only preview (no editing script), e.g. for picking a template in a campaign. */
export function renderTemplatePreview(t: EmailTemplate, shopName: string): RenderedEmail {
  return renderEmail({ template: t, vars: SAMPLE_VARS(shopName) });
}
