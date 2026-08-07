"use client";

/**
 * PrintExportButton — a keyboard-focusable header action that exports the
 * current view via the browser's print-to-PDF dialog (window.print()).
 *
 * Used in server-component pages where no server-side export endpoint exists.
 * This provides a genuine action rather than a dead control.
 */
export function PrintExportButton({
  label = "Export",
  className = "btn ghost",
  style,
  documentTitle,
}: {
  label?: string;
  className?: string;
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
    <button type="button" className={className} style={style} onClick={handlePrint}>
      {label}
    </button>
  );
}
