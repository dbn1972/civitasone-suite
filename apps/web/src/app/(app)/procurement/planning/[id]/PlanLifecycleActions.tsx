"use client";

import { useRouter } from "next/navigation";
import { ActionButton } from "@/app/_components/ds";

/**
 * Drives the Annual Procurement Plan maker-checker chain: draft → pending
 * (submit) → approved / rejected (services/procurement-service/src/modules/
 * planning/schema.ts). Before this component existed there was no UI at all
 * for these three backend actions, even though the plan detail page itself
 * was also missing — see planning/[id]/page.tsx and _data/loaders.ts.
 *
 * Uses ActionButton (not a hand-rolled confirm), matching SignSrnAction's
 * pattern: no bespoke "success!" text is shown on confirm, only
 * `onSuccess={() => router.refresh()}`. These are 202-accepted async commands
 * (sendAccepted in planning/routes.ts) — claiming "Approved!" immediately
 * would be the same L3 lying-success bug fixed in DispatchPOActions.tsx.
 * Refreshing and letting the real StatusPill reflect whatever the server has
 * actually done is the honest behaviour.
 */
export function PlanLifecycleActions({ planId, status }: { planId: string; status: string }) {
  const router = useRouter();

  async function submit(reason?: string): Promise<void> {
    const res = await fetch(`/api/proxy/v1/procurement/plans/${planId}/submit`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(reason ? { notes: reason } : {}),
    });
    if (!res.ok) throw new Error((await res.text()) || "Could not submit the plan.");
  }

  async function approve(reason?: string): Promise<void> {
    const res = await fetch(`/api/proxy/v1/procurement/plans/${planId}/approve`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(reason ? { notes: reason } : {}),
    });
    if (!res.ok) throw new Error((await res.text()) || "Could not approve the plan.");
  }

  async function reject(reason?: string): Promise<void> {
    const res = await fetch(`/api/proxy/v1/procurement/plans/${planId}/reject`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      // Backend requires a non-empty reason (rejectPlanBody) — ActionButton's
      // requireReason below keeps the Confirm button disabled until one is
      // typed, so `reason` is guaranteed non-empty here in practice.
      body: JSON.stringify({ reason: reason ?? "" }),
    });
    if (!res.ok) throw new Error((await res.text()) || "Could not reject the plan.");
  }

  if (status === "draft") {
    return (
      <div className="card pad" style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
        <ActionButton
          label="Submit for approval"
          confirmTitle="Submit this plan for approval?"
          confirmDescription="The plan moves to Pending Approval and can no longer be edited as a draft."
          confirmLabel="Submit"
          onConfirm={submit}
          onSuccess={() => router.refresh()}
        />
      </div>
    );
  }

  if (status === "pending") {
    return (
      <div className="card pad" style={{ marginTop: 12, display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <ActionButton
          label="Reject"
          confirmTitle="Reject this plan?"
          confirmDescription="Rejecting returns the plan to the originating department for revision. A reason is mandatory and recorded in the audit trail."
          confirmLabel="Reject"
          danger
          requireReason
          reasonLabel="Reason for rejection (required)"
          onConfirm={reject}
          onSuccess={() => router.refresh()}
        />
        <ActionButton
          label="Approve"
          confirmTitle="Approve this plan?"
          confirmDescription="This approves the annual procurement plan and moves it into the ministry's approved plan register. This cannot be undone."
          confirmLabel="Approve"
          onConfirm={approve}
          onSuccess={() => router.refresh()}
        />
      </div>
    );
  }

  return null;
}
