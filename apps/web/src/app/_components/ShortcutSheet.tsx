"use client";

/**
 * Accessible modal dialog listing all keyboard shortcuts,
 * grouped by category. Built on ds/Modal (SF-19), which owns the focus trap,
 * inert background, Escape and focus restore.
 */
import { Modal } from "./ds/Modal";
import type { Shortcut } from "./KeyboardShortcuts";

interface ShortcutSheetProps {
  open: boolean;
  onClose: () => void;
  shortcuts: Shortcut[];
}

export function ShortcutSheet({ open, onClose, shortcuts }: ShortcutSheetProps) {
  if (!open) return null;

  const grouped = {
    Navigation: shortcuts.filter((s) => s.category === "Navigation"),
    Actions: shortcuts.filter((s) => s.category === "Actions"),
    System: shortcuts.filter((s) => s.category === "System"),
  };

  return (
    <Modal open onClose={onClose} title="Keyboard Shortcuts" zIndex={9999}>
      <div style={{ maxHeight: "70vh", overflow: "auto" }}>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
          <button
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
    </Modal>
  );
}
