import { emailTemplateSchema } from "../email/schema";
import {
  contentSchema,
  designSchema,
  detailsSchema,
  discountIdSchema,
  rulesSchema,
  type CampaignInput,
} from "./schema";

// Pure (no server imports): shared by the route actions and the editor's live preview.
export type FieldErrors = Record<string, string>;
export type ParseResult =
  | { ok: true; input: CampaignInput }
  | { ok: false; errors: FieldErrors };

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "");

/** Builds a validated CampaignInput from the editor's flat form fields. */
export function parseCampaignForm(fd: FormData): ParseResult {
  const errors: FieldErrors = {};
  const collect = (prefix: string, issues: { path: PropertyKey[]; message: string }[]) => {
    for (const i of issues) errors[`${prefix}.${String(i.path[0])}`] ??= i.message;
  };

  const details = detailsSchema.safeParse({
    name: str(fd, "details.name"),
    status: str(fd, "details.status"),
    template: str(fd, "details.template"),
  });
  const content = contentSchema.safeParse(
    Object.fromEntries(
      Object.keys(contentSchema.shape).map((k) => [k, str(fd, `content.${k}`)]),
    ),
  );
  const design = designSchema.safeParse({
    ...Object.fromEntries(
      Object.keys(designSchema.shape).map((k) => [k, str(fd, `design.${k}`)]),
    ),
    showCloseIcon: fd.get("design.showCloseIcon") === "on",
  });
  const rules = rulesSchema.safeParse({
    ...Object.fromEntries(
      Object.keys(rulesSchema.shape).map((k) => [k, str(fd, `rules.${k}`)]),
    ),
    specificUrls: str(fd, "rules.specificUrls")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean),
    firstPurchaseOnly: fd.get("rules.firstPurchaseOnly") === "on",
  });

  if (!details.success) collect("details", details.error.issues);
  if (!content.success) collect("content", content.error.issues);
  if (!design.success) collect("design", design.error.issues);
  if (!rules.success) collect("rules", rules.error.issues);

  if (!details.success || !content.success || !design.success || !rules.success) {
    return { ok: false, errors };
  }
  if (rules.data.pages === "specific" && rules.data.specificUrls.length === 0) {
    return { ok: false, errors: { "rules.specificUrls": "Add at least one URL" } };
  }
  // The email editor keeps its template as one JSON document (a block editor does not map to flat fields).
  let emailRaw: unknown = undefined;
  try {
    const json = str(fd, "email");
    emailRaw = json ? JSON.parse(json) : undefined;
  } catch {
    return { ok: false, errors: { email: "The email template could not be read. Reload and try again." } };
  }
  const email = emailTemplateSchema.safeParse(emailRaw);
  if (!email.success) {
    const i = email.error.issues[0];
    return { ok: false, errors: { email: `Email: ${i.path.length ? i.path.join(" > ") + ": " : ""}${i.message}` } };
  }
  const discountId = discountIdSchema.safeParse(str(fd, "discountId") || null);
  if (!discountId.success) {
    return { ok: false, errors: { discountId: "Select a valid Shopify discount" } };
  }
  return {
    ok: true,
    input: {
      discountId: discountId.data,
      details: details.data,
      content: content.data,
      design: design.data,
      rules: rules.data,
      email: email.data,
    },
  };
}
