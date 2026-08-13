"use client";

/**
 * In-app feedback widget: floating "Was this helpful?" prompt.
 * Shows at bottom-right, expands to comment input on thumb click.
 * Fire-and-forget POST to admin feedback endpoint.
 * Remembers dismissal per page for 24h via localStorage.
 */
import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";

const STORAGE_PREFIX = "civitasone.feedback.";
const HIDE_DURATION_MS = 24 * 60 * 60 * 1000; // 24h

export function FeedbackWidget() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [rating, setRating] = useState<"positive" | "negative" | null>(null);

  useEffect(() => {
    // Check if we already collected feedback for this page recently
    const key = `${STORAGE_PREFIX}${pathname}`;
    try {
      const stored = localStorage.getItem(key);
      if (stored) {
        const ts = parseInt(stored, 10);
        if (Date.now() - ts < HIDE_DURATION_MS) {
          setVisible(false);
          return;
        }
      }
    } catch {
      // ignore
    }
    setVisible(true);
    setExpanded(false);
    setSubmitted(false);
    setComment("");
    setRating(null);
  }, [pathname]);

  const submitFeedback = useCallback(
    (selectedRating: "positive" | "negative", text?: string) => {
      // Fire-and-forget — no await needed
      fetch("/api/proxy/v1/admin/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          page: pathname,
          rating: selectedRating,
          comment: text || undefined,
          timestamp: new Date().toISOString(),
        }),
      }).catch(() => {
        /* silent */
      });

      // Mark as submitted in localStorage
      try {
        localStorage.setItem(`${STORAGE_PREFIX}${pathname}`, String(Date.now()));
      } catch {
        /* ignore */
      }

      setSubmitted(true);
      setTimeout(() => setVisible(false), 2000);
    },
    [pathname],
  );


  const dismiss = () => {
    try {
      localStorage.setItem(`${STORAGE_PREFIX}${pathname}`, String(Date.now()));
    } catch { /* ignore */ }
    setVisible(false);
  };

  const handleThumb = (type: "positive" | "negative") => {
    setRating(type);
    setExpanded(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (rating) submitFeedback(rating, comment);
  };

  const handleSkip = () => {
    if (rating) submitFeedback(rating);
  };

  if (!visible) return null;

  return (
    <div
      role="complementary"
      aria-label="Page feedback"
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 1000,
        background: "var(--surface, #fff)",
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        padding: "12px 16px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
        fontSize: 14,
        maxWidth: 320,
      }}
    >
      {submitted ? (
        <span style={{ color: "#059669", fontWeight: 500 }}>Thanks for your feedback!</span>
      ) : !expanded ? (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ color: "#374151" }}>Was this helpful?</span>
          <button
            onClick={() => handleThumb("positive")}
            aria-label="Yes, this was helpful"
            style={{ border: "none", background: "none", cursor: "pointer", fontSize: 20, padding: 4 }}
          >
            👍
          </button>
          <button
            onClick={() => handleThumb("negative")}
            aria-label="No, this was not helpful"
            style={{ border: "none", background: "none", cursor: "pointer", fontSize: 20, padding: 4 }}
          >
            👎
          </button>
          <button
            onClick={dismiss}
            aria-label="Dismiss feedback prompt"
            style={{ border: "none", background: "none", cursor: "pointer", fontSize: 18, color: "#9ca3af", padding: "0 0 0 4px", lineHeight: 1 }}
          >
            ×
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={{ fontSize: 13, color: "#6b7280" }}>
            Any details? (optional)
          </label>
          <input
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Tell us more…"
            maxLength={500}
            autoFocus
            style={{
              border: "1px solid #d1d5db",
              borderRadius: 6,
              padding: "6px 10px",
              fontSize: 14,
              outline: "none",
            }}
          />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={handleSkip}
              style={{ border: "none", background: "none", cursor: "pointer", fontSize: 13, color: "#6b7280" }}
            >
              Skip
            </button>
            <button
              type="submit"
              style={{
                border: "none",
                background: "#2563eb",
                color: "#fff",
                borderRadius: 6,
                padding: "4px 12px",
                fontSize: 13,
                cursor: "pointer",
                fontWeight: 500,
              }}
            >
              Send
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
