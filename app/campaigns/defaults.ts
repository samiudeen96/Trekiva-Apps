import type { CampaignInput } from "./schema";

export const defaultCampaign: CampaignInput = {
  discountId: null,
  details: { name: "Welcome 10% Popup", status: "DRAFT", template: "SPLIT_IMAGE" },
  content: {
    title: "Get 10% Off Your First Order",
    description: "Enter your email to receive your welcome offer.",
    emailPlaceholder: "Enter your email",
    buttonText: "Get 10% Off",
    successTitle: "Check your inbox 🎉",
    successMessage:
      "Your 10% welcome offer is on its way! Check your inbox for your discount code.",
    alreadyClaimedTitle: "Already claimed",
    alreadyClaimedMessage: "You’ve already claimed this welcome offer.",
    privacyText: "By signing up you agree to receive marketing emails. Unsubscribe anytime.",
  },
  design: {
    backgroundColor: "#ffffff",
    textColor: "#1a1a1a",
    buttonBackground: "#1a1a1a",
    buttonTextColor: "#ffffff",
    borderRadius: 12,
    overlayOpacity: 55,
    popupWidth: 720,
    imageUrl: "",
    imagePosition: "left",
    showCloseIcon: true,
    alignment: "left",
  },
  rules: {
    trigger: "delay",
    delaySeconds: 5,
    pages: "all",
    specificUrls: [],
    devices: "all",
    frequency: "visitor",
    frequencyDays: 7,
  },
};
