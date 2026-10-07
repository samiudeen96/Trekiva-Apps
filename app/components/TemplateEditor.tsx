import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { renderEmail, sampleProducts } from "../email/render";
import { newSection, SECTION_LABELS } from "../email/defaults";
import { EMAIL_PLACEHOLDERS, type EmailSection, type EmailSectionType, type EmailTemplate } from "../email/schema";
import type { RenderedEmail } from "../email/render";
import { pushEdit, redoEdit, startHistory, undoEdit } from "../email/history";

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

/** Wraps the selection (or inserts a placeholder word) and puts the cursor back where the reader expects it. */
function RichToolbar(props: { area: React.RefObject<HTMLTextAreaElement | null>; value: string; max: number; onChange: (v: string) => void }) {
  const [linking, setLinking] = useState(false);
  const [url, setUrl] = useState("https://");
  const edit = (fn: (before: string, sel: string, after: string) => { text: string; from: number; to: number }) => {
    const el = props.area.current;
    if (!el) return;
    const a = el.selectionStart;
    const b = el.selectionEnd;
    const r = fn(props.value.slice(0, a), props.value.slice(a, b), props.value.slice(b));
    if (r.text.length > props.max) return;
    props.onChange(r.text);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(r.from, r.to);
    });
  };
  const wrap = (mark: string, fallback: string) =>
    edit((before, sel, after) => {
      const inner = sel || fallback;
      return { text: `${before}${mark}${inner}${mark}${after}`, from: before.length + mark.length, to: before.length + mark.length + inner.length };
    });
  const list = () =>
    edit((before, sel, after) => {
      const body = (sel || "List item").split("\n").map((l) => (/^[-•]\s/.test(l) ? l : `- ${l}`)).join("\n");
      const lead = before === "" || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
      return { text: `${before}${lead}${body}${after}`, from: before.length + lead.length, to: before.length + lead.length + body.length };
    });
  const link = () => {
    const ok = /^https:\/\/\S+$/.test(url) || url === "{{discount_link}}" || url === "{{shop_url}}";
    if (!ok) return;
    edit((before, sel, after) => {
      const label = sel || "link text";
      const md = `[${label}](${url})`;
      return { text: `${before}${md}${after}`, from: before.length + 1, to: before.length + 1 + label.length };
    });
    setLinking(false);
    setUrl("https://");
  };
  const tb: CSSProperties = { ...btn, padding: "4px 10px", minWidth: 32 };
  const urlOk = /^https:\/\/\S+$/.test(url) || url === "{{discount_link}}" || url === "{{shop_url}}";
  return (
    <div style={{ marginBottom: 6 }}>
      <div role="toolbar" aria-label="Text formatting" style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        <button type="button" style={{ ...tb, fontWeight: 800 }} aria-label="Bold" title="Bold" onClick={() => wrap("**", "bold text")}>B</button>
        <button type="button" style={{ ...tb, fontStyle: "italic" }} aria-label="Italic" title="Italic" onClick={() => wrap("*", "italic text")}>I</button>
        <button type="button" style={tb} aria-label="Link" title="Link" aria-expanded={linking} onClick={() => setLinking((l) => !l)}>Link</button>
        <button type="button" style={tb} aria-label="Bulleted list" title="Bulleted list" onClick={list}>• List</button>
      </div>
      {linking && (
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <input
            style={{ ...input, ...(urlOk ? {} : { borderColor: "#d92d20" }) }}
            aria-label="Link address"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                link();
              }
            }}
          />
          <button type="button" style={btn} disabled={!urlOk} onClick={link}>Add</button>
        </div>
      )}
      {linking && <p style={small}>An https address, or {"{{discount_link}}"} to apply the customer&apos;s code.</p>}
    </div>
  );
}

function Text(props: { label: string; value: string; max: number; onChange: (v: string) => void; hint?: string; url?: "plain" | "link"; area?: boolean; rich?: boolean }) {
  const problem = props.url ? urlProblem(props.value, props.url === "link") : null;
  const area = useRef<HTMLTextAreaElement>(null);
  if (props.rich) {
    return (
      <Field label={props.label} hint={props.hint}>
        <RichToolbar area={area} value={props.value} max={props.max} onChange={props.onChange} />
        <textarea ref={area} style={{ ...input, minHeight: 110, resize: "vertical" }} maxLength={props.max} value={props.value} onChange={(e) => props.onChange(e.target.value)} />
        <p style={small}>
          Select text, then use B, I, Link or List. Typed as **bold**, *italic*, [text](https://…) and “- ” list lines.
        </p>
      </Field>
    );
  }
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

type ProductSection = Extract<EmailSection, { type: "product" }>;

/** Which products an email shows: picked with Shopify's own product and collection pickers. */
function ProductFields({ s, set }: { s: ProductSection; set: (s: EmailSection) => void }) {
  const shopify = useAppBridge();
  const pickCollection = async () => {
    const picked = await shopify.resourcePicker({ type: "collection", multiple: false, action: "select" });
    const c = picked?.[0];
    if (c) set({ ...s, collectionId: c.id as ProductSection["collectionId"], collectionTitle: String(c.title ?? "").slice(0, 120) });
  };
  const pickProducts = async () => {
    const picked = await shopify.resourcePicker({
      type: "product",
      multiple: 8,
      action: "select",
      filter: { variants: false },
      selectionIds: s.productIds.map((id) => ({ id })),
    });
    if (!picked) return;
    set({
      ...s,
      productIds: picked.map((p) => p.id) as ProductSection["productIds"],
      productTitles: picked.map((p) => String(p.title ?? "").slice(0, 120)),
    });
  };
  return (
    <>
      <Text label="Heading" value={s.heading} max={120} onChange={(heading) => set({ ...s, heading })} />
      <Pick
        label="Show"
        value={s.source}
        options={[["newest", "Newest products"], ["collection", "Products from a collection"], ["static", "Products I pick"]]}
        onChange={(source) => set({ ...s, source })}
      />
      {s.source === "collection" && (
        <>
          <Field label="Collection" hint="For best sellers, pick a collection of your products and sort it by best selling.">
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ flex: 1, fontSize: 14 }}>{s.collectionTitle || <span style={{ color: "#d92d20" }}>None chosen</span>}</span>
              <button type="button" style={btn} onClick={pickCollection}>{s.collectionId ? "Change" : "Choose"}</button>
            </div>
          </Field>
          <Pick
            label="Order"
            value={s.collectionSort}
            options={[["best_selling", "Best selling"], ["manual", "The collection's own order"], ["newest", "Newest first"]]}
            onChange={(collectionSort) => set({ ...s, collectionSort })}
          />
        </>
      )}
      {s.source === "static" && (
        <Field label="Products" hint="Up to 8. If one is deleted or hidden from the online store before an email is sent, it is left out.">
          {s.productTitles.length > 0 && (
            <ul style={{ margin: "0 0 8px", paddingLeft: 18, fontSize: 14 }}>
              {s.productTitles.map((t, i) => (
                <li key={`${s.productIds[i]}-${i}`}>{t}</li>
              ))}
            </ul>
          )}
          <button type="button" style={btn} onClick={pickProducts}>{s.productIds.length ? "Change products" : "Choose products"}</button>
        </Field>
      )}
      {s.source !== "static" && (
        <Field label="How many">
          <input type="number" style={input} min={1} max={8} value={s.count} onChange={(e) => set({ ...s, count: Math.min(8, Math.max(1, Number(e.target.value) || 1)) })} />
        </Field>
      )}
      <Pick label="Columns" value={String(s.columns)} options={[["1", "1"], ["2", "2"], ["3", "3"]]} onChange={(c) => set({ ...s, columns: Number(c) as 1 | 2 | 3 })} />
      <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, fontSize: 14 }}>
        <input type="checkbox" checked={s.showPrice} onChange={(e) => set({ ...s, showPrice: e.target.checked })} />
        Show the price
      </label>
      <Text label="Button label" value={s.buttonLabel} max={40} hint="Empty = no button; the image and name still link to the product." onChange={(buttonLabel) => set({ ...s, buttonLabel })} />
      <p style={small}>The canvas shows sample products. Real products, prices and images are loaded each time an email is sent.</p>
    </>
  );
}

function SectionFields({ s, set }: { s: EmailSection; set: (s: EmailSection) => void }) {
  switch (s.type) {
    case "product":
      return <ProductFields s={s} set={set} />;
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
          <Text label="Text" area rich value={s.body} max={2000} hint="Leave a blank line between paragraphs." onChange={(body) => set({ ...s, body })} />
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
          <Text label="Text" area rich value={s.body} max={600} onChange={(body) => set({ ...s, body })} />
          <Text label="Button label" value={s.buttonLabel} max={40} onChange={(buttonLabel) => set({ ...s, buttonLabel })} />
          <Text label="Button link" value={s.buttonUrl} max={2048} url="link" hint="{{discount_link}} applies the customer's code." onChange={(buttonUrl) => set({ ...s, buttonUrl })} />
          <Pick label="Image position" value={s.imagePosition} options={[["left", "Left"], ["right", "Right"]]} onChange={(imagePosition) => set({ ...s, imagePosition })} />
        </>
      );
    case "discount":
      return (
        <>
          <p style={{ ...small, marginBottom: 10 }}>The customer&apos;s own code, plus a button that applies it for them.</p>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 10, fontSize: 14 }}>
            <input type="checkbox" checked={s.showCode} onChange={(e) => set({ ...s, showCode: e.target.checked })} style={{ marginTop: 3 }} />
            <span>
              Show the code in the email
              <span style={{ ...small, display: "block" }}>
                {s.showCode
                  ? "Customers can copy it and type it at checkout."
                  : "Hidden: the customer can only use it through the button, so it needs a button label. If the link does not apply the code on your checkout, they have no other way to get it."}
              </span>
            </span>
          </label>
          <Text label="Heading" value={s.heading} max={120} onChange={(heading) => set({ ...s, heading })} />
          <Text label="Description" area rich value={s.description} max={400} onChange={(description) => set({ ...s, description })} />
          <Text label="Button label" value={s.buttonLabel} max={40} hint="Empty hides the button." onChange={(buttonLabel) => set({ ...s, buttonLabel })} />
          <Text label="After applying, send them to" value={s.redirectPath} max={200} hint='Optional. A store path such as /collections/sandals. Leave empty to land on the home page. The button already applies the discount, so do not paste a link here.' onChange={(redirectPath) => set({ ...s, redirectPath })} />
          <Text label="Conditions / expiry note" area rich value={s.note} max={300} hint="e.g. Valid on your first order. Expires in 30 days." onChange={(note) => set({ ...s, note })} />
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
    case "product":
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
  { label: "Product", types: ["product"] },
  { label: "Offer", types: ["discount"] },
  { label: "Layout", types: ["imageText", "columns", "header"] },
];

const panelTitle: CSSProperties = { margin: 0, fontSize: 14, fontWeight: 650 };
const group: CSSProperties = { borderTop: "1px solid #ebebeb", padding: "14px 16px" };
const groupTitle: CSSProperties = { margin: "0 0 10px", fontSize: 13, fontWeight: 650 };

/** The template being edited, with undo and redo. */
export function useTemplateHistory(initial: EmailTemplate) {
  const [state, setState] = useState(() => startHistory(initial));
  const set = useCallback((next: EmailTemplate) => setState((s) => pushEdit(s, next, Date.now())), []);
  const undo = useCallback(() => setState(undoEdit), []);
  const redo = useCallback(() => setState(redoEdit), []);
  return { value: state.present, set, undo, redo, canUndo: state.past.length > 0, canRedo: state.future.length > 0 };
}

const LOOK_TYPES: EmailSectionType[] = ["text", "imageText", "discount", "button", "columns", "product"];

/** Messaging's "Layout" group: the section's own background and vertical spacing. */
function LookFields({ s, set }: { s: EmailSection; set: (s: EmailSection) => void }) {
  if (!LOOK_TYPES.includes(s.type)) return null;
  const look = s as EmailSection & { bg?: string; padY?: number | null };
  const patch = (p: { bg?: string; padY?: number | null }) => set({ ...s, ...p } as EmailSection);
  return (
    <div style={group}>
      <p style={groupTitle}>Layout</p>
      <Field label="Background color">
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="color" aria-label="Section background color" value={look.bg || "#ffffff"} onChange={(e) => patch({ bg: e.target.value })} style={{ width: 56, height: 34, padding: 2, border: "1px solid #8a8a8a", borderRadius: 6, background: "#fff" }} />
          <span style={{ fontSize: 13, color: "#616161" }}>{look.bg || "Same as the email"}</span>
          {look.bg ? <button type="button" style={btn} onClick={() => patch({ bg: "" })}>Reset</button> : null}
        </div>
      </Field>
      <Field label="Top and bottom spacing (px)" hint="Empty = automatic.">
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="range"
            aria-label="Top and bottom spacing"
            min={0}
            max={80}
            value={look.padY ?? 16}
            onChange={(e) => patch({ padY: Number(e.target.value) })}
            style={{ flex: 1 }}
          />
          <span style={{ width: 52, fontSize: 13, textAlign: "right" }}>{look.padY == null ? "Auto" : `${look.padY} px`}</span>
          {look.padY != null ? <button type="button" style={btn} onClick={() => patch({ padY: null })}>Auto</button> : null}
        </div>
      </Field>
    </div>
  );
}

export interface TemplateEditorProps {
  name: string;
  onNameChange: (name: string) => void;
  value: EmailTemplate;
  onChange: (t: EmailTemplate) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Edits not saved yet, shown as a badge like Messaging's "Draft". */
  dirty: boolean;
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
  const [search, setSearch] = useState("");
  const [to, setTo] = useState("");
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const scrollY = useRef(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const addBox = useRef<HTMLDivElement>(null);
  const searchBox = useRef<HTMLInputElement>(null);

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
  const moveTo = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= value.sections.length || to >= value.sections.length) return;
    const next = [...value.sections];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
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
    setSearch("");
  };
  const cannotDelete = (s: EmailSection) =>
    value.sections.length === 1 || (s.type === "discount" && discounts === 1)
      ? "Keep at least one discount section: it carries the customer's code"
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

  // Undo / redo shortcuts, but never while typing: a field keeps its own native undo.
  const { undo, redo } = p;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // The Add menu closes on Escape and on a click anywhere else.
  useEffect(() => {
    if (!adding) return;
    searchBox.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (addBox.current && !addBox.current.contains(e.target as Node)) setAdding(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAdding(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [adding]);

  const [html, setHtml] = useState(() => build(value, p.shopName, null, 0));
  useEffect(() => {
    const t = setTimeout(() => setHtml(build(value, p.shopName, selected, scrollY.current)), 200);
    return () => clearTimeout(t);
  }, [value, p.shopName, selected]);

  const q = search.trim().toLowerCase();
  const matches = (t: EmailSectionType) => !q || SECTION_LABELS[t].toLowerCase().includes(q);
  const visibleGroups = ADD_GROUPS.map((g) => ({ ...g, types: g.types.filter(matches) })).filter((g) => g.types.length);
  const circle: CSSProperties = { ...btn, padding: "6px 10px" };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* Top bar, like Messaging's: history, devices, status and Send test. */}
      <div style={{ ...box, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", position: "sticky", top: 0, zIndex: 4 }}>
        <button type="button" style={circle} aria-label="Undo" title="Undo (Ctrl/Cmd+Z)" disabled={!p.canUndo} onClick={p.undo}>↶ Undo</button>
        <button type="button" style={circle} aria-label="Redo" title="Redo (Ctrl/Cmd+Shift+Z)" disabled={!p.canRedo} onClick={p.redo}>Redo ↷</button>
        <span style={{ width: 1, height: 22, background: "#ddd", margin: "0 4px" }} />
        <button type="button" aria-pressed={device === "desktop"} style={{ ...circle, ...(device === "desktop" ? { background: "#1a1a1a", color: "#fff" } : {}) }} onClick={() => setDevice("desktop")}>Desktop</button>
        <button type="button" aria-pressed={device === "mobile"} style={{ ...circle, ...(device === "mobile" ? { background: "#1a1a1a", color: "#fff" } : {}) }} onClick={() => setDevice("mobile")}>Mobile</button>
        <span
          role="status"
          style={{ fontSize: 12, fontWeight: 600, padding: "3px 8px", borderRadius: 999, background: p.dirty ? "#fff1d6" : "#e3f1df", color: p.dirty ? "#7a4a00" : "#1b5e20" }}
        >
          {p.dirty ? "Unsaved changes" : "All changes saved"}
        </span>
        <div style={{ flex: 1 }} />
        <input type="email" aria-label="Send a test to" style={{ ...input, width: 220 }} placeholder="you@example.com" value={to} onChange={(e) => setTo(e.target.value)} />
        <button type="button" style={circle} disabled={!p.from || !to || p.sendingTest} onClick={() => p.onSendTest(to)}>
          {p.sendingTest ? "Sending…" : "Send test"}
        </button>
      </div>
      {p.testResult && <p style={{ ...small, margin: 0, color: p.testResult.ok ? "#047b5d" : "#d92d20" }}>{p.testResult.message}</p>}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 320px) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
        {/* Left: settings for the whole email, or for the selected section. */}
        <aside style={{ ...box, padding: 0, position: "sticky", top: 70, maxHeight: "calc(100vh - 90px)", overflowY: "auto" }}>
          {section ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 16px" }}>
                <button type="button" style={{ ...btn, padding: "4px 8px" }} aria-label="Back to email settings" onClick={() => setSelected(null)}>←</button>
                <h3 style={panelTitle}>{SECTION_LABELS[section.type]}</h3>
              </div>
              <div style={group}>
                <SectionFields s={section} set={(next) => setSections(value.sections.map((x) => (x.id === section.id ? next : x)))} />
              </div>
              <LookFields s={section} set={(next) => setSections(value.sections.map((x) => (x.id === section.id ? next : x)))} />
            </>
          ) : (
            <>
              <div style={{ padding: "14px 16px" }}>
                <h3 style={panelTitle}>Email</h3>
                <p style={small}>Click a section in the email to edit it, or drag the ⋮⋮ handles below to reorder.</p>
              </div>
              <div style={group}>
                <Text label="Template name" value={p.name} max={80} hint="Only you see this. Campaigns pick templates by name." onChange={p.onNameChange} />
              </div>
              <div style={group}>
                <p style={groupTitle}>Sections</p>
                <div style={{ display: "grid", gap: 4 }}>
                  {value.sections.map((s, i) => (
                    <div
                      key={s.id}
                      draggable
                      onDragStart={(e) => {
                        setDragFrom(i);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragOver={(e) => {
                        if (dragFrom === null) return;
                        e.preventDefault();
                        setDragOver(i);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (dragFrom !== null) moveTo(dragFrom, i);
                        setDragFrom(null);
                        setDragOver(null);
                      }}
                      onDragEnd={() => {
                        setDragFrom(null);
                        setDragOver(null);
                      }}
                      style={{ display: "flex", alignItems: "center", gap: 4, opacity: dragFrom === i ? 0.4 : 1, borderTop: dragOver === i && dragFrom !== null && dragFrom !== i ? "2px solid #2c6ecb" : "2px solid transparent" }}
                    >
                      <span aria-hidden="true" title="Drag to reorder" style={{ cursor: "grab", color: "#8a8a8a", padding: "0 4px", userSelect: "none" }}>⋮⋮</span>
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
          <details open style={box}>
            <summary style={{ ...groupTitle, margin: 0, cursor: "pointer" }}>Email details</summary>
            <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: "4px 12px", alignItems: "center", fontSize: 13, marginTop: 12 }}>
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
          </details>

          {/* Actions for the selected section, where Messaging floats them beside it. */}
          <div style={{ ...box, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", minHeight: 26 }} role="toolbar" aria-label="Selected section">
            {section ? (
              <>
                <span style={{ fontWeight: 600, fontSize: 13, marginRight: 4 }}>{SECTION_LABELS[section.type]}</span>
                <button type="button" style={btn} disabled={index === 0} onClick={() => move(index, -1)}>↑ Move up</button>
                <button type="button" style={btn} disabled={index === value.sections.length - 1} onClick={() => move(index, 1)}>↓ Move down</button>
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
                <button type="button" style={{ ...btn, marginLeft: "auto" }} onClick={() => setSelected(null)}>Done</button>
              </>
            ) : (
              <span style={{ fontSize: 13, color: "#616161" }}>Click a section in the email to edit it.</span>
            )}
          </div>

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

          <div ref={addBox} style={{ position: "relative" }}>
            <button type="button" style={{ ...btn, background: "#2c6ecb", color: "#fff", borderColor: "#2c6ecb" }} disabled={full} aria-expanded={adding} aria-haspopup="menu" onClick={() => setAdding((a) => !a)}>
              + Add section{section ? ` after ${SECTION_LABELS[section.type]}` : ""}
            </button>
            {full && <span style={{ ...small, marginLeft: 8 }}>20 sections is the maximum.</span>}
            {adding && (
              <div role="menu" style={{ ...box, position: "absolute", bottom: "calc(100% + 6px)", left: 0, width: 260, zIndex: 6, boxShadow: "0 6px 20px rgba(0,0,0,.15)", padding: 8, maxHeight: 360, overflowY: "auto" }}>
                <input
                  ref={searchBox}
                  style={{ ...input, marginBottom: 6 }}
                  placeholder="Search sections"
                  aria-label="Search sections"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && visibleGroups[0]) {
                      e.preventDefault();
                      add(visibleGroups[0].types[0]);
                    }
                  }}
                />
                {visibleGroups.length === 0 && <p style={{ ...small, margin: 6 }}>No section matches “{search}”.</p>}
                {visibleGroups.map((g) => (
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
    </div>
  );
}

const SAMPLE_VARS = (shopName: string, t: EmailTemplate) => ({
  products: sampleProducts(t),
  code: SAMPLE_CODE,
  discountBase: `https://example.myshopify.com/discount/${SAMPLE_CODE}`,
  shopName,
  shopUrl: "https://example.myshopify.com/",
  firstName: null,
  unsubscribeUrl: "#",
});

function build(t: EmailTemplate, shopName: string, selectedId: string | null, scrollY: number): string {
  return renderEmail({ template: t, vars: SAMPLE_VARS(shopName, t), preview: { selectedId, scrollY } }).html;
}

/** Read-only preview (no editing script), e.g. for picking a template in a campaign. */
export function renderTemplatePreview(t: EmailTemplate, shopName: string): RenderedEmail {
  return renderEmail({ template: t, vars: SAMPLE_VARS(shopName, t) });
}
