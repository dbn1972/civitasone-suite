"use client";

/**
 * PrintExportButton — a real, keyboard-focusable header action that prints the
 * current view via the browser print-to-PDF dialog (window.print()).
 *
 * GAP-STOCK-DASHBOARD-07: stock-service exposes no data-export endpoint, so this
 * is honestly labelled "Print" (print-to-PDF) by default rather than "Export",
 * which would imply a data download that does not exist. A genuine action, not
 * a dead control.
 */
export function PrintExportButton({
  label = "Print",
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
      <span aria-hidden="true" style={{ marginRight: 6 }}>🖨️</span>
      {label}
    </button>
  );
}
