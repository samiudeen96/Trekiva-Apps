import { emailTemplateSchema, type EmailSection, type EmailSectionType, type EmailTemplate } from "./schema";

export const defaultEmail: EmailTemplate = {
  schemaVersion: 1,
  subject: "Your welcome offer from {{shop_name}}",
  previewText: "Your personal discount code is inside",
  brand: {
    backgroundColor: "#f1f1f1",
    contentBackgroundColor: "#ffffff",
    textColor: "#1a1a1a",
    buttonColor: "#000000",
    buttonTextColor: "#ffffff",
    fontFamily: "sans",
    width: 600,
  },
  sections: [
    { type: "header", id: "header", logoUrl: "", logoWidth: 160, align: "center", backgroundColor: "#ffffff" },
    {
      type: "text",
      id: "intro",
      heading: "Welcome to {{shop_name}}",
      body: "Hi {{first_name}},\n\nThanks for signing up. Here is your personal welcome offer.",
      align: "center",
    },
    {
      type: "discount",
      id: "discount",
      showCode: true,
      heading: "Your welcome code",
      description: "Copy this code and enter it at checkout, or use the button to have it applied for you.",
      note: "",
      buttonLabel: "Shop now",
      redirectPath: "",
    },
  ],
  footer: { address: "" },
};

/**
 * The template a campaign actually sends. A campaign saved before email templates existed stores {},
 * which resolves to the default. Anything stored that no longer validates also falls back to the
 * default rather than sending a broken email.
 */
export function resolveEmailTemplate(stored: unknown): EmailTemplate {
  const merged = { ...defaultEmail, ...(stored && typeof stored === "object" ? stored : {}) };
  const parsed = emailTemplateSchema.safeParse(merged);
  return parsed.success ? parsed.data : defaultEmail;
}

let counter = 0;
const newId = (type: string) => `${type}-${Date.now().toString(36)}${(counter++).toString(36)}`;

/** A fresh section with sensible starting content, for the editor's "Add section". */
export function newSection(type: EmailSectionType): EmailSection {
  const id = newId(type);
  switch (type) {
    case "header":
      return { type, id, logoUrl: "", logoWidth: 160, align: "center", backgroundColor: "#ffffff" };
    case "text":
      return { type, id, heading: "A heading", body: "Write something for your customer here.", align: "left" };
    case "image":
      return { type, id, imageUrl: "", alt: "", linkUrl: "" };
    case "imageText":
      return {
        type,
        id,
        imageUrl: "",
        alt: "",
        heading: "Heading",
        body: "A short description.",
        buttonLabel: "Shop now",
        buttonUrl: "{{discount_link}}",
        imagePosition: "left",
      };
    case "discount":
      return { type, id, showCode: true, heading: "Your welcome code", description: "", note: "", buttonLabel: "Shop now", redirectPath: "" };
    case "button":
      return { type, id, label: "Shop now", url: "{{discount_link}}", align: "center" };
    case "columns":
      return {
        type,
        id,
        items: [
          { title: "Free shipping", text: "On orders over a set amount." },
          { title: "Easy returns", text: "Not right? Send it back." },
        ],
      };
    case "product":
      return {
        type,
        id,
        heading: "You might also like",
        source: "newest",
        collectionId: null,
        collectionTitle: "",
        collectionSort: "best_selling",
        productIds: [],
        productTitles: [],
        count: 4,
        columns: 2,
        showPrice: true,
        buttonLabel: "",
      };
  }
}

export const SECTION_LABELS: Record<EmailSectionType, string> = {
  header: "Header (logo)",
  text: "Text",
  image: "Image / banner",
  imageText: "Image with text",
  discount: "Discount code",
  button: "Button",
  columns: "Columns",
  product: "Products",
};

export interface Starter {
  key: string;
  name: string;
  description: string;
  template: EmailTemplate;
}

/** Starting points for "Create template". Each is a complete, valid template. */
export const STARTERS: Starter[] = [
  {
    key: "welcome",
    name: "Welcome",
    description: "Logo, a short greeting and the customer's code.",
    template: defaultEmail,
  },
  {
    key: "minimal",
    name: "Minimal",
    description: "Just the logo and the code. Quick to read on a phone.",
    template: {
      ...defaultEmail,
      sections: [
        defaultEmail.sections[0],
        {
          type: "discount",
          id: "discount",
          showCode: true,
          heading: "Your welcome code",
          description: "Use this code at checkout.",
          note: "",
          buttonLabel: "Shop now",
          redirectPath: "",
        },
      ],
    },
  },
  {
    key: "showcase",
    name: "Showcase",
    description: "A banner, the code, then your store's benefits in columns.",
    template: {
      ...defaultEmail,
      sections: [
        defaultEmail.sections[0],
        { type: "image", id: "banner", imageUrl: "", alt: "Welcome offer", linkUrl: "{{discount_link}}" },
        defaultEmail.sections[1],
        defaultEmail.sections[2],
        {
          type: "columns",
          id: "benefits",
          items: [
            { title: "Free shipping", text: "On orders over a set amount." },
            { title: "Easy returns", text: "Not the right fit? Send it back." },
            { title: "Made to last", text: "Comfort you can wear every day." },
          ],
        },
        { type: "button", id: "shop", label: "Shop the collection", url: "{{discount_link}}", align: "center" },
      ],
    },
  },
];
