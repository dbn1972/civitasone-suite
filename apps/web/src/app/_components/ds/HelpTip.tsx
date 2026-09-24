"use client";

import { useId, useState, useRef, useEffect, type ReactNode } from "react";

/**
 * HelpTip — an accessible "?" tooltip that explains a specialist term in one
 * plain sentence. Built for a no-training audience (gov office clerk).
 *
 * Accessibility:
 * - The trigger is a real <button> (keyboard focusable, 24px min target).
 * - The popover is linked via aria-describedby and announced to screen readers.
 * - Opens on hover, focus, click; closes on blur, Escape, outside click.
 * - Works without JS hover (focus/click), and degrades to the native title attr.
 * - A short grace period on mouseleave (not blur/Escape/outside-click) gives
 *   the pointer time to travel from the trigger into the popover itself
 *   before it closes -- without it, a diagonal mouse move across the small
 *   gap between the "?" button and the popover below it closed the tooltip
 *   before the pointer ever reached the popover's content.
 */
export function HelpTip({ term, children }: { term?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function cancelScheduledClose() {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }

  function scheduleClose() {
    cancelScheduledClose();
    closeTimer.current = setTimeout(() => setOpen(false), 200);
  }

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Cancel any pending close if the component unmounts mid-grace-period.
  useEffect(() => cancelScheduledClose, []);

  const plain = typeof children === "string" ? children : undefined;

  return (
    <span ref={wrapRef} style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      <button
        type="button"
        aria-label={term ? `What is ${term}?` : "More information"}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        title={plain}
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => {
          cancelScheduledClose();
          setOpen(true);
        }}
        onMouseLeave={scheduleClose}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        style={{
          // WCAG 2.2 SC 2.5.8 Target Size Minimum: interactive targets need
          // >=24x24 CSS px. This was 18x18 (the docstring above always
          // claimed 24px, but the style never matched it) -- UX-005 tranche 5.
          width: 24, height: 24, minWidth: 24, minHeight: 24, marginLeft: 5, marginRight: 5, padding: 0,
          borderRadius: "50%", border: "1px solid var(--line, #cbd5e1)",
          background: "var(--bg, #f1f5f9)", color: "var(--ink2, #475569)",
          fontSize: 11, fontWeight: 700, lineHeight: 1, cursor: "help",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
        }}
      >
        ?
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          onMouseEnter={cancelScheduledClose}
          onMouseLeave={scheduleClose}
          style={{
            position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 60,
            width: "max-content", maxWidth: 280, padding: "8px 10px",
            background: "#0f172a", color: "#fff", borderRadius: 8,
            fontSize: 12.5, lineHeight: 1.45, fontWeight: 400,
            boxShadow: "0 8px 24px -8px rgba(0,0,0,0.4)", whiteSpace: "normal",
          }}
        >
          {term ? <strong style={{ display: "block", marginBottom: 2 }}>{term}</strong> : null}
          {children}
        </span>
      )}
    </span>
  );
}
