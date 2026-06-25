"use client";

/**
 * PrintExportButton — a real, keyboard-focusable header action that exports /
 * prints the current view via the browser print-to-PDF dialog (window.print()).
 *
 * stock-service exposes no ledger export or label-print endpoint, so "Export"
 * and "Print Label" are wired to print-to-PDF — a genuine action rather than a
 * dead control.
 */
export function PrintExportButton({
  label = "Export",
  className = "btn ghost",
  documentTitle,
}: {
  label?: string;
  className?: string;
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
    <button type="button" className={className} onClick={handlePrint}>
      🖨️ {label}
    </button>
  );
}
