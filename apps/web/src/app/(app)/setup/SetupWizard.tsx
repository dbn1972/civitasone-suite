"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Card, StatusPill, ProgressBar } from "../../_components/ds";
import { SampleDataControls } from "./SampleDataControls";
import { trackActivation, type FunnelStep } from "@/lib/activation";
import type { WizardStep, StepStatus } from "@/lib/setupSteps";

type StepView = WizardStep & { status: StepStatus };

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
}: {
  steps: StepView[];
  doneCount: number;
  totalCount: number;
  progress: number;
  ready: boolean;
  resumeIndex: number;
  /** True when at least one step's status couldn't be determined. (R8.4) */
  progressUnknown: boolean;
}) {
  const resumeRef = useRef<HTMLDivElement | null>(null);

  // Resume: bring the first incomplete step into view on load. (R9.2)
  useEffect(() => {
    resumeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
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
  else if (ready) encouragement = "All set — your office is ready to go. 🎉";
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
          <p role="status" style={{ margin: "8px 0 0", fontSize: 12.5, color: "#92400e" }}>
            We couldn&apos;t check one or two steps just now. Refresh in a moment to update your progress.
          </p>
        )}
      </Card>

      {ready && (
        <Card padding>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span aria-hidden="true" style={{ fontSize: 26 }}>🎉</span>
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
          const href = `${step.entryHref}?return=/setup`;
          return (
            <div key={step.key} ref={isResume ? resumeRef : undefined}>
              <Card>
                <div
                  className="pad"
                  style={isResume ? { outline: "2px solid var(--primary, #4f46e5)", outlineOffset: -2, borderRadius: 12 } : undefined}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span aria-hidden="true" style={{ fontSize: 22 }}>{step.icon}</span>
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
                      <Link href="/dashboard" className="btn ghost" aria-label={`Skip "${step.title}" and do it later`}>
                        Do it later
                      </Link>
                    )}
                    {step.status === "unknown" && (
                      <span style={{ fontSize: 12.5, color: "#92400e" }}>
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
        {process.env.NEXT_PUBLIC_SAMPLE_DATA_ENABLED === "true" && <SampleDataControls />}
      </div>

      <p style={{ marginTop: 18, color: "var(--mut)", fontSize: 13 }}>
        You can come back to this page any time from <strong>Getting Started</strong> in the menu. Nothing is lost if you step away.
      </p>
    </>
  );
}
