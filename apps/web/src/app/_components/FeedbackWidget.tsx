"use client";

/**
 * In-app feedback widget: floating "Was this helpful?" prompt.
 * Shows at bottom-right, expands to comment input on thumb click.
 * Fire-and-forget POST to admin feedback endpoint.
 *
 * Earned, not ambushed: it no longer appears the instant a page paints — it
 * waits SHOW_DELAY_MS so the clerk sees the page first, which also means it
 * won't sit on top of real content the moment a screen loads (this is what
 * caused it to cover a module tile's label on the Finance dashboard). A
 * plain dismiss (the X) is remembered app-wide for 24h — the same one-global-
 * key convention WhatsNewBanner already uses — since "not now" is a
 * statement about the app, not about the one page it happened to be shown
 * on; without this it re-earns itself on every one of the app's 70+ routes.
 * Actually submitting a rating still only silences that one exact page for
 * 24h, since "was this page helpful" is a legitimately page-specific
 * question.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "./ds";

const STORAGE_PREFIX = "civitasone.feedback.";
const GLOBAL_DISMISS_KEY = `${STORAGE_PREFIX}dismissedUntil`;
const HIDE_DURATION_MS = 24 * 60 * 60 * 1000; // 24h
const SHOW_DELAY_MS = 5000; // let the clerk see the page before we ask about it

function recentlyMarked(key: string): boolean {
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return false;
    const ts = parseInt(stored, 10);
    return Date.now() - ts < HIDE_DURATION_MS;
  } catch {
    return false;
  }
}

function mark(key: string) {
  try {
    localStorage.setItem(key, String(Date.now()));
  } catch {
    /* ignore */
  }
}

export function FeedbackWidget() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [rating, setRating] = useState<"positive" | "negative" | null>(null);
  const commentInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (expanded) commentInputRef.current?.focus();
  }, [expanded]);

  useEffect(() => {
    setVisible(false);
    setExpanded(false);
    setSubmitted(false);
    setComment("");
    setRating(null);

    // A global dismiss, or feedback already given on this exact page, means
    // don't ask again yet — don't make the clerk re-earn the prompt's
    // silence on every one of the app's 70+ routes just because the
    // pathname changed.
    if (recentlyMarked(GLOBAL_DISMISS_KEY) || recentlyMarked(`${STORAGE_PREFIX}${pathname}`)) {
      return;
    }

    const timer = setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    return () => clearTimeout(timer);
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

      // This exact page has its feedback now — don't ask again here for 24h.
      mark(`${STORAGE_PREFIX}${pathname}`);

      setSubmitted(true);
      setTimeout(() => setVisible(false), 2000);
    },
    [pathname],
  );

  const dismiss = () => {
    // A plain "not now" is app-wide, not just for this one page — otherwise
    // closing it here does nothing to stop it popping up on the next click.
    mark(GLOBAL_DISMISS_KEY);
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
            style={{
              border: "none",
              background: "none",
              cursor: "pointer",
              // #9ca3af (gray-400) measured 2.53:1 on white — below the 4.5:1
              // AA minimum. #6b7280 (gray-500) is the same muted-icon color
              // already used for WhatsNewBanner's passing dismiss button
              // (~4.8:1 on white).
              color: "#6b7280",
              padding: "0 0 0 4px",
              lineHeight: 1,
              display: "inline-flex",
            }}
          >
            {/*
              Icon, not a "×" text glyph: a single decorative character reads
              as ambiguous "short text content" to axe's color-contrast rule,
              which treats that as an undecided, blocking result regardless of
              the actual color. An SVG icon isn't subject to that heuristic.
              The accessible name still comes from aria-label above.
            */}
            <X aria-hidden="true" size={16} />
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label htmlFor="feedback-widget-comment" style={{ fontSize: 13, color: "#6b7280" }}>
            Any details? (optional)
          </label>
          <input
            id="feedback-widget-comment"
            ref={commentInputRef}
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Tell us more…"
            maxLength={500}
            style={{
              border: "1px solid #d1d5db",
              borderRadius: 6,
              padding: "6px 10px",
              fontSize: 14,
              outline: "none",
            }}
          />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button type="button" variant="ghost" size="sm" onClick={handleSkip}>
              Skip
            </Button>
            <Button type="submit" variant="primary" size="sm">
              Send
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
