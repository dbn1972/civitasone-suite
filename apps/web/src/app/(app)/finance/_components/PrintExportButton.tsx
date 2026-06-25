"use client";

/**
 * PrintExportButton — a real, keyboard-focusable header action that exports the
 * current view via the browser's print-to-PDF dialog (window.print()).
 *
 * Finance has no server-side PDF/MIS export endpoint for statements, the GL or
 * the dashboard (only per-voucher PDF exists at /v1/finance/journals/:id/pdf),
 * so "Export PDF" / "Export MIS" are wired to print-to-PDF — a genuine action
 * rather than a dead control.
 */
export function PrintExportButton({
  label = "Export PDF",
  documentTitle,
}: {
  label?: string;
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
    <button type="button" className="btn ghost" onClick={handlePrint}>
      🖨️ {label}
    </button>
  );
}
