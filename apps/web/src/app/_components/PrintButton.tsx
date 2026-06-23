"use client";

import React from "react";

interface PrintButtonProps {
  title?: string;
}

export function PrintButton({ title }: PrintButtonProps) {
  const handlePrint = () => {
    if (title) {
      const prevTitle = document.title;
      document.title = title;
      window.print();
      document.title = prevTitle;
    } else {
      window.print();
    }
  };

  return (
    <div style={{ display: "inline-flex", gap: 4 }}>
      <button
        onClick={handlePrint}
        type="button"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 12px",
          border: "1px solid #d1d5db",
          borderRadius: 6,
          background: "#fff",
          fontSize: 13,
          color: "#374151",
          cursor: "pointer",
          fontWeight: 500,
        }}
        title="Print or save as PDF"
      >
        <span>🖨️</span>
        Print / PDF
      </button>
    </div>
  );
}
