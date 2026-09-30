"use client";

/**
 * ChecklistWithActions — client wrapper that wires OnboardingChecklist's
 * "Mark done" button to the real backend.
 *
 * GAP-HR-ONBOARDING-DETAIL-01: OnboardingChecklist has always supported an
 * onComplete callback (renders "Mark done" only when one is passed), and
 * PATCH /v1/hrms/onboarding-tasks/:taskId/complete has always existed --
 * but [id]/page.tsx (a server component, which cannot pass a function prop)
 * rendered <OnboardingChecklist steps={checklist} /> with no handler, so
 * the button never appeared and HR had no way to tick a task off from the
 * joinee's own page.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { OnboardingChecklist, type ChecklistStep } from "./OnboardingChecklist";
import { useFormError } from "@/lib/useFormError";

interface ChecklistWithActionsProps {
  steps: ChecklistStep[];
}

export function ChecklistWithActions({ steps: initialSteps }: ChecklistWithActionsProps) {
  const router = useRouter();
  const [steps, setSteps] = useState(initialSteps);
  const [error, setError] = useState<string | null>(null);
  const formError = useFormError("onboarding checklist");

  async function handleComplete(id: string) {
    const previous = steps;
    setError(null);
    // Optimistic: OnboardingChecklist only shows "Mark done" while a step is
    // not yet "completed", so flipping it locally immediately hides the
    // button and shows the tick, without waiting on the round trip.
    setSteps((current) => current.map((step) => (step.id === id ? { ...step, status: "completed" } : step)));

    try {
      const res = await fetch(`/api/proxy/v1/hrms/onboarding-tasks/${id}/complete`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
      });
      if (!res.ok) {
        setSteps(previous);
        setError((await formError.fromResponse(res, "save")).message);
        return;
      }
      // The write applies asynchronously via the F3 queue (see
      // onboarding-routes.ts's publishF3Write), not synchronously in this
      // response -- refresh shortly after so the server-rendered progress
      // bar / overdue counts on this page pick up the real committed state
      // rather than only ever showing the optimistic local view.
      setTimeout(() => router.refresh(), 1000);
    } catch {
      setSteps(previous);
      setError(formError.fromException("save").message);
    }
  }

  return (
    <div>
      <OnboardingChecklist steps={steps} onComplete={(id) => void handleComplete(id)} />
      {error && (
        <p role="alert" style={{ margin: "10px 0 0", fontSize: 12, color: "var(--bad, #dc2626)", fontWeight: 500 }}>
          {error}
        </p>
      )}
    </div>
  );
}
