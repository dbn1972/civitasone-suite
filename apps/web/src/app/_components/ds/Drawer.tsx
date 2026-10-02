"use client";
/**
 * Drawer -- a scrollable dialog for a record's detail/edit form with a sticky footer.
 *
 * Built on `Modal`, which owns the accessibility mechanics (document.body
 * portal, role=dialog + aria-modal + aria-labelledby, focus moved in on open,
 * Tab trap, Escape / overlay-click close, focus restored to the trigger, and
 * background made inert). GAP-ADMIN-INTEGRATIONS-06: the Integrations drawer
 * was a hand-rolled overlay div with an Escape handler but no focus management.
 *
 * `busy` blocks every close path (Escape, overlay click) while a request is in
 * flight, so a half-sent change can't be dismissed from under the operator.
 */
import type { ReactNode } from "react";
import { Modal } from "./Modal";

export interface DrawerProps {
  open?: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** Rendered in a bordered footer below the scrolling body. */
  footer?: ReactNode;
  /** Blocks closing while true. */
  busy?: boolean;
}

export function Drawer({ open = true, onClose, title, children, footer, busy = false }: DrawerProps) {
  return (
    <Modal
      open={open}
      onClose={() => { if (!busy) onClose(); }}
      closeOnOverlayClick={!busy}
      size="lg"
      title={title}
    >
      <div style={{ maxHeight: "70vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 16, paddingTop: 8 }}>
        {children}
      </div>
      {footer && (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
          {footer}
        </div>
      )}
    </Modal>
  );
}
