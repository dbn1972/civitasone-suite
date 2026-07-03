"use client";

/**
 * Accessible modal dialog listing all keyboard shortcuts,
 * grouped by category. Supports focus trap and Escape to close.
 */
import { useEffect, useRef } from "react";
import type { Shortcut } from "./KeyboardShortcuts";

interface ShortcutSheetProps {
  open: boolean;
  onClose: () => void;
  shortcuts: Shortcut[];
}

export function ShortcutSheet({ open, onClose, shortcuts }: ShortcutSheetProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Focus trap + Escape handling
  useEffect(() => {
    if (!open) return;

    // Focus the close button when opening
    closeButtonRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      // Simple focus trap within the dialog
      if (e.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const grouped = {
    Navigation: shortcuts.filter((s) => s.category === "Navigation"),
    Actions: shortcuts.filter((s) => s.category === "Actions"),
    System: shortcuts.filter((s) => s.category === "System"),
  };

  return (
    <div
      className="shortcut-sheet-overlay"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.5)",
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface, #fff)",
          borderRadius: 12,
          padding: "24px 32px",
          maxWidth: 520,
          width: "90vw",
          maxHeight: "80vh",
          overflow: "auto",
          boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Keyboard Shortcuts</h2>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Close shortcuts dialog"
            style={{
              border: "none",
              background: "none",
              cursor: "pointer",
              fontSize: 20,
              padding: 4,
              borderRadius: 4,
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {Object.entries(grouped).map(([category, items]) =>
          items.length > 0 ? (
            <section key={category} style={{ marginBottom: 20 }}>
              <h3 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.05em", color: "#6b7280", margin: "0 0 8px" }}>
                {category}
              </h3>
              <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 16px" }}>
                {items.map((s) => (
                  <div key={s.keys} style={{ display: "contents" }}>
                    <kbd
                      style={{
                        fontFamily: "monospace",
                        fontSize: 13,
                        padding: "2px 6px",
                        borderRadius: 4,
                        background: "#f3f4f6",
                        border: "1px solid #e5e7eb",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {s.keys}
                    </kbd>
                    <span style={{ fontSize: 14, color: "#374151" }}>{s.label}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null,
        )}

        <p style={{ fontSize: 12, color: "#9ca3af", margin: "16px 0 0" }}>
          Press the first key, then the second within 1.5 seconds. Shortcuts are disabled while typing in inputs.
        </p>
      </div>
    </div>
  );
}
