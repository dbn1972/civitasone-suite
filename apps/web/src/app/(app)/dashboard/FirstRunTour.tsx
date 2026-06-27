"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

/**
 * FirstRunTour — a short, friendly walkthrough shown once on first login.
 *
 * Written for a no-training clerk: it explains, in four plain steps, where the
 * main things live and where to get help. It is fully skippable, remembers that
 * it has been seen (localStorage), and is keyboard + screen-reader accessible
 * (focus-trapped dialog, Escape to close, labelled controls).
 *
 * We deliberately use a centred dialog rather than element-anchored coach-marks:
 * it is robust across screen sizes and doesn't break if the layout shifts.
 */

const STORAGE_KEY = "civitasone.tour.dashboard.v1";

type TourStep = {
  icon: string;
  title: string;
  body: string;
};

const STEPS: TourStep[] = [
  {
    icon: "👋",
    title: "Welcome to CivitasOne",
    body: "This is your office's workspace. Here's a quick 30-second tour so you know where everything is. You can skip it any time.",
  },
  {
    icon: "🧭",
    title: "The menu on the left",
    body: "Every part of the system — Finance, HR, Procurement and more — is in the menu on the left. Only the parts your office uses are shown.",
  },
  {
    icon: "🚀",
    title: "Start with Getting Started",
    body: "New office? Open 'Getting Started' to set up your office, add branches and invite your team — one small step at a time.",
  },
  {
    icon: "❓",
    title: "Help is always one click away",
    body: "Stuck on a word or a screen? Open the Help Centre, or click the small ? next to any specialist term for a plain-English explanation.",
  },
];

export function FirstRunTour() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  // Only show if the clerk hasn't seen (or dismissed) it before.
  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setOpen(true);
    } catch {
      /* localStorage unavailable (private mode) — just don't show the tour */
    }
  }, []);

  // Move focus into the dialog when it opens, handle Escape, and trap focus. (R11.2)
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeBtnRef.current?.focus();

    const FOCUSABLE =
      'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        finish();
        return;
      }
      if (e.key !== "Tab") return;
      const node = dialogRef.current;
      if (!node) return;
      const focusables = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.(); // restore focus on close (R11.2)
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step]);

  function remember() {
    try {
      localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    } catch {
      /* ignore */
    }
  }

  function finish() {
    remember();
    setOpen(false);
  }

  if (!open) return null;

  const isLast = step === STEPS.length - 1;
  const current = STEPS[step];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
      aria-describedby="tour-body"
      onClick={(e) => {
        if (e.target === e.currentTarget) finish();
      }}
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(15,23,42,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        ref={dialogRef}
        className="card"
        style={{ width: "100%", maxWidth: 460, padding: 0, overflow: "hidden" }}
      >
        <div style={{ padding: "22px 22px 8px" }}>
          <div aria-hidden="true" style={{ fontSize: 34, marginBottom: 6 }}>{current.icon}</div>
          <h2 id="tour-title" style={{ margin: "0 0 8px", fontSize: 19, letterSpacing: "-0.3px" }}>
            {current.title}
          </h2>
          <p id="tour-body" style={{ margin: 0, color: "var(--ink2, #475569)", lineHeight: 1.55, fontSize: 14.5 }}>
            {current.body}
          </p>
        </div>

        {/* progress dots */}
        <div style={{ display: "flex", gap: 6, padding: "10px 22px 0" }} aria-hidden="true">
          {STEPS.map((_, i) => (
            <span
              key={i}
              style={{
                height: 6, flex: 1, borderRadius: 3,
                background: i <= step ? "var(--primary, #4f46e5)" : "var(--line, #e2e8f0)",
              }}
            />
          ))}
        </div>

        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            gap: 8, padding: "16px 22px 20px",
          }}
        >
          <button
            ref={closeBtnRef}
            type="button"
            className="btn ghost"
            onClick={finish}
          >
            Skip
          </button>

          <div style={{ display: "flex", gap: 8 }}>
            {step > 0 && (
              <button type="button" className="btn ghost" onClick={() => setStep((s) => s - 1)}>
                Back
              </button>
            )}
            {!isLast ? (
              <button type="button" className="btn primary" onClick={() => setStep((s) => s + 1)}>
                Next
              </button>
            ) : (
              <Link href="/setup" className="btn primary" onClick={finish}>
                Start setup
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
