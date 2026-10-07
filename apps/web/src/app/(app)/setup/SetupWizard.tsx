"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import {
  Building2,
  MapPin,
  Layers,
  Users,
  Puzzle,
  BookOpen,
  Palmtree,
  Wallet,
  PartyPopper,
  type LucideIcon,
} from "lucide-react";
import { Card, StatusPill, ProgressBar } from "../../_components/ds";
import { SampleDataControls } from "./SampleDataControls";
import { trackActivation, type FunnelStep } from "@/lib/activation";
import type { WizardStep, StepStatus, WizardStepKey } from "@/lib/setupSteps";
import { scrollBehavior } from "@/lib/motion";

type StepView = WizardStep & { status: StepStatus };

/**
 * GAP-SETUP-HOME-06: step icons come from the DS lucide set (like Sidebar and
 * StatIcon), not OS colour-emoji, which render as a ".notdef" box on headless
 * Linux and are inconsistent with the design system. Keyed by step so the
 * mapping is explicit and independent of the emoji in the data model.
 */
const STEP_ICON: Record<WizardStepKey, LucideIcon> = {
  "org-profile": Building2,
  branches: MapPin,
  departments: Layers,
  people: Users,
  modules: Puzzle,
  "finance-year-coa": BookOpen,
  "leave-policies": Palmtree,
  "pay-structure": Wallet,
};

/**
 * SetupWizard — the clerk-facing first-run organisation setup.
 *
 * Honest by construction: every status is derived from real tenant data on the
 * server and passed in. We never claim completion from a prior visit. Steps stay
 * re-enterable, optional steps can be skipped, and the wizard resumes by focusing
 * the first step that isn't complete. Requirements 7, 8, 9, 13.3.
 */
export function SetupWizard({
  steps,
  doneCount,
  totalCount,
  progress,
  ready,
  resumeIndex,
  progressUnknown,
  sampleDataEnabled,
}: {
  steps: StepView[];
  doneCount: number;
  totalCount: number;
  progress: number;
  ready: boolean;
  resumeIndex: number;
  /** True when at least one step's status couldn't be determined. (R8.4) */
  progressUnknown: boolean;
  /** Whether the sample-data ("try it") controls are available (server-gated). */
  sampleDataEnabled: boolean;
}) {
  const resumeRef = useRef<HTMLDivElement | null>(null);

  // Resume: bring the first incomplete step into view on load. (R9.2)
  // UX-005: honors prefers-reduced-motion -- instant jump instead of an
  // animated scroll when the user has asked for reduced motion.
  useEffect(() => {
    resumeRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
  }, []);

  // Activation funnel: record that the wizard was opened, plus any golden-path
  // steps that are already complete (the server keeps the earliest timestamp).
  useEffect(() => {
    const FUNNEL: Record<string, FunnelStep> = {
      "org-profile": "org-profile", branches: "branches",
      departments: "departments", people: "people", modules: "modules",
    };
    const completed = steps
      .filter((s) => s.status === "complete" && FUNNEL[s.key])
      .map((s) => FUNNEL[s.key]);
    for (const step of ["wizard_opened" as FunnelStep, ...completed]) {
      const key = `civitasone.activation.${step}`;
      try {
        if (sessionStorage.getItem(key)) continue;
        sessionStorage.setItem(key, "1");
      } catch { /* still emit; server dedups */ }
      trackActivation(step);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  let encouragement: string;
  if (doneCount === 0) encouragement = "Let's get your office ready — one small step at a time.";
  else if (ready) encouragement = "All set — your office is ready to go.";
  else if (doneCount >= totalCount - 2) encouragement = "Nice — you're almost there!";
  else encouragement = "Great start. Keep going whenever you have a moment.";

  function pillFor(status: StepStatus) {
    if (status === "complete") return <StatusPill status="completed" label="Done" />;
    if (status === "unknown") return <StatusPill status="pending" label="Couldn't check" />;
    return <StatusPill status="draft" label="To do" />;
  }

  return (
    <>
      <Card padding>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
          <strong style={{ fontSize: 15 }}>{doneCount} of {totalCount} steps done</strong>
          <span style={{ color: "var(--mut)", fontSize: 13 }}>{encouragement}</span>
        </div>
        <ProgressBar value={progress} />
        {progressUnknown && (
          <p role="status" style={{ margin: "8px 0 0", fontSize: 12.5, color: "var(--warn)" }}>
            We couldn&apos;t check one or two steps just now. Refresh in a moment to update your progress.
          </p>
        )}
      </Card>

      {ready && (
        <Card padding>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span aria-hidden="true" style={{ display: "inline-flex", color: "var(--good)" }}>
              <PartyPopper size={26} aria-hidden="true" />
            </span>
            <div style={{ flex: 1 }}>
              <h3 style={{ margin: "0 0 4px", fontSize: 16 }}>Your office is ready</h3>
              <p style={{ margin: 0, color: "var(--mut)", fontSize: 13.5 }}>
                The essentials are set up. You can start working now, or fine-tune the optional steps below.
              </p>
            </div>
            <Link href="/dashboard" className="btn primary">Go to dashboard</Link>
          </div>
        </Card>
      )}

      <div className="grid g-2" style={{ marginTop: 16 }}>
        {steps.map((step, idx) => {
          const isResume = idx === resumeIndex && step.status !== "complete";
          // GAP-SETUP-HOME-04: no target page reads a `return` param, so the
          // old ?return=/setup was a misleading no-op — link straight to the
          // step's screen instead.
          const href = step.entryHref;
          const StepIcon = STEP_ICON[step.key];
          return (
            <div key={step.key} ref={isResume ? resumeRef : undefined}>
              <Card>
                <div
                  className="pad"
                  style={isResume ? { outline: "2px solid var(--primary)", outlineOffset: -2, borderRadius: 12 } : undefined}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span aria-hidden="true" style={{ display: "inline-flex", color: "var(--primary)" }}>
                        <StepIcon size={22} aria-hidden="true" />
                      </span>
                      <div>
                        <div style={{ fontSize: 12, color: "var(--mut)", fontWeight: 600 }}>Step {step.num}</div>
                        <h3 style={{ margin: 0, fontSize: 16, letterSpacing: "-0.2px" }}>{step.title}</h3>
                      </div>
                    </div>
                    {pillFor(step.status)}
                  </div>

                  <p style={{ margin: "12px 0 6px", color: "var(--ink)", lineHeight: 1.5 }}>{step.explanation}</p>
                  <p style={{ margin: "0 0 14px", color: "var(--mut)", fontSize: 13, fontStyle: "italic" }}>{step.example}</p>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                    <Link href={href} className="btn primary">
                      {step.status === "complete" ? "Review" : step.cta}
                    </Link>
                    {!step.required && step.status !== "complete" && (
                      // GAP-SETUP-HOME-02: this link only navigates to the
                      // dashboard; it does NOT persist a deferral, so the label
                      // must say exactly that rather than implying "do it later"
                      // was saved. (No per-tenant skip store exists yet — see
                      // HUMAN REVIEW.)
                      <Link href="/dashboard" className="btn ghost" aria-label={`Skip "${step.title}" and go to the dashboard`}>
                        Skip to dashboard
                      </Link>
                    )}
                    {step.status === "unknown" && (
                      <span style={{ fontSize: 12.5, color: "var(--warn)" }}>
                        We couldn&apos;t check this step right now.
                      </span>
                    )}
                  </div>
                </div>
              </Card>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 18 }}>
        {sampleDataEnabled && <SampleDataControls />}
      </div>

      <p style={{ marginTop: 18, color: "var(--mut)", fontSize: 13 }}>
        You can come back to this page any time from <strong>Getting Started</strong> in the menu. Nothing is lost if you step away.
      </p>
    </>
  );
}
