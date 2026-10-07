import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useNavigation, useSubmit } from "react-router";
import { renderEmail } from "../email/render";
import { newSection, SECTION_LABELS } from "../email/defaults";
import { EMAIL_PLACEHOLDERS, type EmailSection, type EmailSectionType, type EmailTemplate } from "../email/schema";

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

interface Props {
  value: EmailTemplate;
  onChange: (t: EmailTemplate) => void;
  /** True when Resend is configured, i.e. the app really sends this email. */
  enabled: boolean;
  /** Display name used where the email says {{shop_name}}. */
  shopName: string;
  testResult?: { ok: boolean; message: string } | null;
}

export function EmailEditor({ value, onChange, enabled, shopName, testResult }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [addType, setAddType] = useState<EmailSectionType>("text");
  const [to, setTo] = useState("");
  const submit = useSubmit();
  const sending = useNavigation().state === "submitting";

  const setSections = (sections: EmailSection[]) => onChange({ ...value, sections });
  const setBrand = (patch: Partial<EmailTemplate["brand"]>) => onChange({ ...value, brand: { ...value.brand, ...patch } });
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= value.sections.length) return;
    const next = [...value.sections];
    [next[i], next[j]] = [next[j], next[i]];
    setSections(next);
  };
  const discounts = value.sections.filter((s) => s.type === "discount").length;

  const [html, setHtml] = useState(() => build(value, shopName));
  // Debounced so typing does not rebuild the iframe on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setHtml(build(value, shopName)), 250);
    return () => clearTimeout(t);
  }, [value, shopName]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* The whole template travels with the form as one JSON field. */}
      <input type="hidden" name="email" value={JSON.stringify(value)} />

      {!enabled && (
        <s-banner tone="info">
          The app is not set up to send email yet (RESEND_API_KEY and EMAIL_FROM are not set), so Shopify Flow still
          sends it. This template is saved and used as soon as sending is configured.
        </s-banner>
      )}

      <div style={box}>
        <Text label="Subject line" value={value.subject} max={150} onChange={(subject) => onChange({ ...value, subject })} />
        <Text label="Preview text" value={value.previewText} max={150} hint="The grey line shown after the subject in the inbox." onChange={(previewText) => onChange({ ...value, previewText })} />
        <p style={small}>
          You can use {EMAIL_PLACEHOLDERS.map((p) => p.token).join(", ")} in any text. {EMAIL_PLACEHOLDERS.map((p) => `${p.token}: ${p.help}`).join(". ")}.
        </p>
      </div>

      <details style={box}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Brand settings</summary>
        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
          <Color label="Page background" value={value.brand.backgroundColor} onChange={(backgroundColor) => setBrand({ backgroundColor })} />
          <Color label="Content background" value={value.brand.contentBackgroundColor} onChange={(contentBackgroundColor) => setBrand({ contentBackgroundColor })} />
          <Color label="Text" value={value.brand.textColor} onChange={(textColor) => setBrand({ textColor })} />
          <Color label="Button / code box" value={value.brand.buttonColor} onChange={(buttonColor) => setBrand({ buttonColor })} />
          <Color label="Button text" value={value.brand.buttonTextColor} onChange={(buttonTextColor) => setBrand({ buttonTextColor })} />
          <Pick label="Font" value={value.brand.fontFamily} options={[["sans", "Sans-serif"], ["serif", "Serif"]]} onChange={(fontFamily) => setBrand({ fontFamily })} />
          <Field label="Content width (px)">
            <input type="number" style={input} min={480} max={680} value={value.brand.width} onChange={(e) => setBrand({ width: Number(e.target.value) || 600 })} />
          </Field>
        </div>
      </details>

      <div style={{ display: "grid", gap: 8 }}>
        {value.sections.map((s, i) => {
          const isOpen = open === s.id;
          const lastDiscount = s.type === "discount" && discounts === 1;
          return (
            <div key={s.id} style={box}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <button type="button" style={{ ...btn, border: 0, fontWeight: 600, flex: 1, textAlign: "left" }} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : s.id)}>
                  {isOpen ? "▾" : "▸"} {SECTION_LABELS[s.type]}
                  {summary(s) && <span style={{ fontWeight: 400, color: "#616161" }}> — {summary(s).slice(0, 40)}</span>}
                </button>
                <button type="button" style={btn} aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                <button type="button" style={btn} aria-label="Move down" disabled={i === value.sections.length - 1} onClick={() => move(i, 1)}>↓</button>
                <button
                  type="button"
                  style={btn}
                  disabled={value.sections.length >= 20}
                  onClick={() => {
                    const copy = { ...structuredClone(s), id: newSection(s.type).id } as EmailSection;
                    const next = [...value.sections];
                    next.splice(i + 1, 0, copy);
                    setSections(next);
                    setOpen(copy.id);
                  }}
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  style={{ ...btn, color: lastDiscount || value.sections.length === 1 ? undefined : "#d92d20" }}
                  disabled={lastDiscount || value.sections.length === 1}
                  title={lastDiscount ? "Keep at least one discount section: it shows the code" : undefined}
                  onClick={() => setSections(value.sections.filter((x) => x.id !== s.id))}
                >
                  Delete
                </button>
              </div>
              {isOpen && (
                <div style={{ marginTop: 12 }}>
                  <SectionFields s={s} set={(next) => setSections(value.sections.map((x) => (x.id === s.id ? next : x)))} />
                </div>
              )}
            </div>
          );
        })}
        <div style={{ ...box, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select aria-label="Section type" style={{ ...input, width: "auto" }} value={addType} onChange={(e) => setAddType(e.target.value as EmailSectionType)}>
            {(Object.keys(SECTION_LABELS) as EmailSectionType[]).map((t) => (
              <option key={t} value={t}>{SECTION_LABELS[t]}</option>
            ))}
          </select>
          <button
            type="button"
            style={btn}
            disabled={value.sections.length >= 20}
            onClick={() => {
              const s = newSection(addType);
              setSections([...value.sections, s]);
              setOpen(s.id);
            }}
          >
            Add section
          </button>
        </div>
      </div>

      <div style={box}>
        <Text label="Footer: sender details" area value={value.footer.address} max={300} hint="Your business name and postal address. The unsubscribe link is always added and cannot be removed." onChange={(address) => onChange({ ...value, footer: { address } })} />
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" style={{ ...btn, ...(device === "desktop" ? { background: "#1a1a1a", color: "#fff" } : {}) }} onClick={() => setDevice("desktop")}>Desktop</button>
          <button type="button" style={{ ...btn, ...(device === "mobile" ? { background: "#1a1a1a", color: "#fff" } : {}) }} onClick={() => setDevice("mobile")}>Mobile</button>
        </div>
        <div style={{ display: "flex", justifyContent: "center", background: "#e3e3e3", borderRadius: 8, padding: 12 }}>
          <iframe title="Email preview" sandbox="" srcDoc={html} style={{ width: device === "mobile" ? 375 : "100%", maxWidth: "100%", height: 640, border: 0, borderRadius: 6, background: "#fff" }} />
        </div>
        <p style={small}>Preview only, with a sample code. Customers who are not subscribed to marketing get a shorter message with just their code.</p>
      </div>

      <div style={box}>
        <Field label="Send a test email" hint="Sends the template as it is now (even unsaved) with a sample code. Needs sending to be configured.">
          <div style={{ display: "flex", gap: 8 }}>
            <input type="email" style={input} placeholder="you@example.com" value={to} onChange={(e) => setTo(e.target.value)} />
            <button
              type="button"
              style={btn}
              disabled={!enabled || !to || sending}
              onClick={() => submit({ intent: "send-test", to, email: JSON.stringify(value) }, { method: "post" })}
            >
              Send test
            </button>
          </div>
        </Field>
        {testResult && <p style={{ ...small, color: testResult.ok ? "#047b5d" : "#d92d20" }}>{testResult.message}</p>}
      </div>
    </div>
  );
}

function build(t: EmailTemplate, shopName: string) {
  return renderEmail({
    template: t,
    vars: {
      code: SAMPLE_CODE,
      discountBase: `https://example.myshopify.com/discount/${SAMPLE_CODE}`,
      shopName,
      shopUrl: "https://example.myshopify.com/",
      firstName: null,
      unsubscribeUrl: "#",
    },
  }).html;
}
