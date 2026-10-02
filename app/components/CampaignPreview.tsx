import { useEffect, useState } from "react";
import type { CampaignInput } from "../campaigns/schema";
import { buildPreviewDoc } from "./preview-doc";

export function CampaignPreview({ input }: { input: CampaignInput }) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [replay, setReplay] = useState(0);
  const [doc, setDoc] = useState(() => buildPreviewDoc(input));

  // Debounced so typing does not rebuild the iframe on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDoc(buildPreviewDoc(input)), 300);
    return () => clearTimeout(t);
  }, [input]);

  return (
    <s-stack gap="base">
      <s-stack direction="inline" gap="small-200">
        <s-button
          variant={device === "desktop" ? "primary" : "secondary"}
          onClick={() => setDevice("desktop")}
        >
          Desktop
        </s-button>
        <s-button
          variant={device === "mobile" ? "primary" : "secondary"}
          onClick={() => setDevice("mobile")}
        >
          Mobile
        </s-button>
        <s-button onClick={() => setReplay((n) => n + 1)}>Replay</s-button>
      </s-stack>
      <div style={{ display: "flex", justifyContent: "center", background: "#e3e3e3", borderRadius: 8, padding: 12 }}>
        <iframe
          key={`${replay}-${doc.length}-${device}`}
          title="Popup preview"
          sandbox="allow-scripts allow-forms"
          srcDoc={doc}
          style={{
            width: device === "mobile" ? 390 : "100%",
            maxWidth: "100%",
            height: 640,
            border: 0,
            borderRadius: 6,
            background: "#f1f1f1",
          }}
        />
      </div>
      <s-text color="subdued">
        Preview only: nothing is sent. Submit an email twice to see the Already claimed state.
      </s-text>
    </s-stack>
  );
}
