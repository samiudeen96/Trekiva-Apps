import { emailTemplateSchema, type EmailTemplate } from "./schema";

export type TemplateFormResult = { ok: true; name: string; template: EmailTemplate } | { ok: false; error: string };

/** The editor posts the name plus the whole template as one JSON field. */
export function parseTemplateForm(fd: FormData): TemplateFormResult {
  const name = String(fd.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Give the template a name." };
  if (name.length > 80) return { ok: false, error: "Keep the name under 80 characters." };
  let raw: unknown;
  try {
    raw = JSON.parse(String(fd.get("template") ?? ""));
  } catch {
    return { ok: false, error: "The template could not be read. Reload the page and try again." };
  }
  const parsed = emailTemplateSchema.safeParse(raw);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return { ok: false, error: `${i.path.length ? i.path.join(" > ") + ": " : ""}${i.message}` };
  }
  return { ok: true, name, template: parsed.data };
}
