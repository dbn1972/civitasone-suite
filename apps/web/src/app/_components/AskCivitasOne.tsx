"use client";

/**
 * AskCivitasOne — floating chat bubble trigger for the AI assistant.
 * Positioned at bottom-right, above the FeedbackWidget.
 * Opens the AskCivitasOnePanel on click.
 */
import { useCallback, useState } from "react";
import { useT } from "@/lib/i18n/LocaleProvider";
import { AskCivitasOnePanel } from "./AskCivitasOnePanel";

export function AskCivitasOne() {
  const t = useT();
  const [isOpen, setIsOpen] = useState(false);

  const handleOpen = useCallback(() => setIsOpen(true), []);
  const handleClose = useCallback(() => setIsOpen(false), []);

  return (
    <>
      {/* Trigger button */}
      {!isOpen && (
        <button
          type="button"
          onClick={handleOpen}
          aria-label={t("assistant.title")}
          title={t("assistant.title")}
          style={{
            position: "fixed",
            bottom: 90,
            right: 24,
            zIndex: 1100,
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "10px 16px",
            background: "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: 24,
            fontSize: 14,
            fontWeight: 500,
            cursor: "pointer",
            boxShadow: "0 4px 12px rgba(37, 99, 235, 0.3)",
            transition: "transform 0.15s ease, box-shadow 0.15s ease",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.transform = "scale(1.05)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.transform = "scale(1)";
          }}
        >
          <span style={{ fontSize: 16 }}>💬</span>
          <span>{t("assistant.trigger")}</span>
        </button>
      )}

      {/* Chat panel */}
      {isOpen && <AskCivitasOnePanel onClose={handleClose} />}
    </>
  );
}
