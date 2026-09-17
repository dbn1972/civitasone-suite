"use client";

import { Button, type ButtonVariant } from "./ds";

/**
 * PrintExportButton — a keyboard-focusable header action that exports the
 * current view via the browser's print-to-PDF dialog (window.print()).
 *
 * Used in server-component pages where no server-side export endpoint exists.
 * This provides a genuine action rather than a dead control.
 *
 * UX-008 tranche 9: renders through the shared `Button`; the free-form
 * `className` prop (unused by every one of the 15 fleet-wide call sites —
 * checked) is replaced by a typed `variant`, defaulting to "ghost" to match
 * prior behavior exactly.
 */
export function PrintExportButton({
  label = "Export",
  variant = "ghost",
  style,
  documentTitle,
}: {
  label?: string;
  variant?: ButtonVariant;
  style?: React.CSSProperties;
  documentTitle?: string;
}) {
  function handlePrint() {
    if (documentTitle) {
      const prev = document.title;
      document.title = documentTitle;
      window.print();
      document.title = prev;
    } else {
      window.print();
    }
  }

  return (
    <Button variant={variant} style={style} onClick={handlePrint}>
      {label}
    </Button>
  );
}
