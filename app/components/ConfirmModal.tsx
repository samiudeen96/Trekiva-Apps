import { useEffect, useRef } from "react";

interface OverlayElement extends HTMLElement {
  showOverlay?: () => void;
  hideOverlay?: () => void;
}

const MODAL_ID = "trekiva-confirm-modal";

/**
 * Shopify's own confirmation dialog (the one the admin shows before deleting a customer).
 * Open it by setting `open` to the thing being confirmed; `onClose` fires on Cancel, the X, Esc
 * and after Confirm, so the parent just clears its state there.
 */
export function ConfirmModal(props: {
  open: boolean;
  heading: string;
  children: React.ReactNode;
  confirmLabel: string;
  /** Red button for destructive actions. */
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const ref = useRef<OverlayElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (props.open) el.showOverlay?.();
    else el.hideOverlay?.();
  }, [props.open]);

  return (
    <s-modal
      ref={(el: OverlayElement | null) => { ref.current = el; }}
      id={MODAL_ID}
      heading={props.heading}
      size="small"
      onHide={props.onClose}
    >
      {props.children}
      <s-button
        slot="primary-action"
        variant="primary"
        {...(props.destructive ? { tone: "critical" as const } : {})}
        {...(props.busy ? { loading: true } : {})}
        onClick={() => {
          props.onConfirm();
          props.onClose();
        }}
      >
        {props.confirmLabel}
      </s-button>
      <s-button slot="secondary-actions" commandFor={MODAL_ID} command="--hide">
        Cancel
      </s-button>
    </s-modal>
  );
}
