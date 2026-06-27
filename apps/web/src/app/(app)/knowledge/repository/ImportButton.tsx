"use client";

export function ImportButton() {
  return (
    <button
      type="button"
      className="btn ghost"
      style={{ minHeight: 44 }}
      onClick={() => {
        window.location.href = "/knowledge/documents/new?mode=import";
      }}
    >
      Import
    </button>
  );
}
