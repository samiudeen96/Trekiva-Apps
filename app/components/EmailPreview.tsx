import { useEffect, useState } from "react";
import type { CampaignContent } from "../campaigns/schema";
import { renderWelcomeOffer, type EmailBranding } from "../email/template";

const SAMPLE_CODE = "WELCOME10-7KQ2M9XH";

function build(content: CampaignContent, branding: EmailBranding) {
  return renderWelcomeOffer({
    content: { subject: content.emailSubject, heading: content.emailHeading, body: content.emailBody },
    discountCode: SAMPLE_CODE,
    branding,
  });
}

export function EmailPreview({ content, branding }: { content: CampaignContent; branding: EmailBranding }) {
  const [email, setEmail] = useState(() => build(content, branding));

  // Debounced so typing does not rebuild the iframe on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setEmail(build(content, branding)), 300);
    return () => clearTimeout(t);
  }, [content, branding]);

  return (
    <s-stack gap="small-200">
      <s-text color="subdued">Subject: {email.subject}</s-text>
      <div style={{ background: "#e3e3e3", borderRadius: 8, padding: 12 }}>
        <iframe
          title="Email preview"
          sandbox=""
          srcDoc={email.html}
          style={{ width: "100%", height: 560, border: 0, borderRadius: 6, background: "#000" }}
        />
      </div>
      <s-text color="subdued">Preview only: nothing is sent. The code shown is a sample.</s-text>
    </s-stack>
  );
}
