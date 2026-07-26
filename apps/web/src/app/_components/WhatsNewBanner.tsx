"use client";

/**
 * What's New changelog banner — shows below the TopBar when a new version
 * is detected. Dismissable and remembers dismissal via localStorage.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { CURRENT_VERSION, getLatestEntry, hasUnseenUpdate } from "@/lib/changelog";

const STORAGE_KEY = "civitasone.lastSeenVersion";

export function WhatsNewBanner() {
  const [visible, setVisible] = useState(false);
  const [title, setTitle] = useState("");

  useEffect(() => {
    try {
      const lastSeen = localStorage.getItem(STORAGE_KEY);
      if (hasUnseenUpdate(lastSeen)) {
        const entry = getLatestEntry();
        if (entry) {
          setTitle(entry.title);
          setVisible(true);
        }
      }
    } catch {
      // localStorage unavailable
    }
  }, []);

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(STORAGE_KEY, CURRENT_VERSION);
    } catch {
      // ignore
    }
  };

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "8px 16px",
        background: "#eff6ff",
        backgroundImage: "linear-gradient(90deg, #eff6ff, #f0fdf4)",
        borderBottom: "1px solid #e0e7ff",
        fontSize: 14,
      }}
    >
      <span>
        <span aria-hidden>✨</span>{" "}
        <strong>New:</strong> {title}{" "}
        <Link
          href="/help/changelog"
          style={{ color: "#2563eb", textDecoration: "underline", fontWeight: 500 }}
        >
          See what&apos;s new →
        </Link>
      </span>
      <button
        onClick={dismiss}
        aria-label="Dismiss what's new banner"
        style={{
          border: "none",
          background: "none",
          cursor: "pointer",
          fontSize: 18,
          lineHeight: 1,
          color: "#6b7280",
          padding: 4,
        }}
      >
        ✕
      </button>
    </div>
  );
}
