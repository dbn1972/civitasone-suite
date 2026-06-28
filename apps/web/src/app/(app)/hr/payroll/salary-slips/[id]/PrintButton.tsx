"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      className="btn primary"
      onClick={() => window.print()}
      style={{ minHeight: 40 }}
    >
      🖨️ Print / Save PDF
    </button>
  );
}
