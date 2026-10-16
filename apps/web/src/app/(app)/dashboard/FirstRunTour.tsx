"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Modal } from "@/app/_components/ds/Modal";

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
 *
 * Investigation note (re-blocking on a "returning" session): live-tested this
 * mount effect directly — Skip/Finish correctly write STORAGE_KEY, and it
 * correctly stays closed across further navigation and reloads in the same
 * browser. No persistence bug found here. The most likely source of a report
 * that this "blocks every load, even for a returning session" is a verification
 * setup that opens a fresh, storage-less browser context per run (this repo's
 * own scripts/dev/capture-screenshots.mjs does exactly that: one Playwright
 * context, no storageState save/load) — every such run looks like a first-ever
 * visit to this localStorage check, no matter how many times the underlying
 * account has actually signed in before. If this keeps reproducing in a real,
 * continuous browser profile, the next step is moving "seen" server-side
 * (there's no such per-user flag yet — see ActivationTracker's "signin" step
 * for the closest existing signal, which is aggregate/analytics-only today,
 * not a per-user read the client can gate on) rather than re-suspecting this
 * effect.
 */

const STORAGE_KEY = "civitasone.tour.dashboard.v1";

/**
 * The localStorage key that records the dashboard first-run tour as seen.
 * Exported so ReplayTourButton can clear exactly this key instead of
 * duplicating the string literal (GAP-HELP-HOME-04).
 */
export const TOUR_STORAGE_KEY = STORAGE_KEY;

type TourStep = {
  icon: string;
  title: string;
  body: string;
};

// COMP-004 detector note: static reference -- fixed onboarding-tour copy
// (see file header), the same for every user; not data from a backend.
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

  // Only show if the clerk hasn't seen (or dismissed) it before.
  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setOpen(true);
    } catch {
      /* localStorage unavailable (private mode) — just don't show the tour */
    }
  }, []);

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

  // SF-19: ds/Modal owns the focus trap, Escape, inert background and focus
  // restore (R11.2). z-index 1200, not the default 1000: it must out-rank the
  // persistent AskCivitasOne (1100) and FeedbackWidget (1000) floating siblings.
  return (
    <Modal
      open
      onClose={finish}
      title={current.title}
      describedById="tour-body"
      zIndex={1200}
    >
      <div>
        <div style={{ padding: "6px 0 8px" }}>
          <div aria-hidden="true" style={{ fontSize: 34, marginBottom: 6 }}>{current.icon}</div>
          <p id="tour-body" style={{ margin: 0, color: "var(--ink2)", lineHeight: 1.55, fontSize: 14.5 }}>
            {current.body}
          </p>
        </div>

        {/* progress dots */}
        <div style={{ display: "flex", gap: 6, padding: "10px 0 0" }} aria-hidden="true">
          {STEPS.map((_, i) => (
            <span
              key={i}
              style={{
                height: 6, flex: 1, borderRadius: 3,
                background: i <= step ? "var(--primary)" : "var(--line)",
              }}
            />
          ))}
        </div>

        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            gap: 8, padding: "16px 0 0",
          }}
        >
          <button
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
    </Modal>
  );
}
