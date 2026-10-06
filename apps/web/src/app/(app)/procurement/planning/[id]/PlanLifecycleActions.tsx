"use client";

import { userFacingErrorFromResponse } from "@/lib/api/userFacingFromResponse";
import { useRouter } from "next/navigation";
import { ActionButton, useToast } from "@/app/_components/ds";
import { useSessionIdentity } from "@/lib/auth/useSessionIdentity";

/**
 * Drives the Annual Procurement Plan maker-checker chain: draft → pending
 * (submit) → approved / rejected (services/procurement-service/src/modules/
 * planning/schema.ts).
 *
 * GAP-PROCUREMENT-PLANNING-DETAIL-02 (audit/maker-checker):
 *  - Approve now REQUIRES a remark (requireReason) so the approval leaves a
 *    recorded comment, mirroring Reject; approve() posts it as `notes`.
 *  - The submitter is never offered Approve on their own plan (separation of
 *    duties). The server (planning/commands.ts assertDistinctMakerChecker →
 *    403 SOD_VIOLATION) remains the authority; this only hides a control that
 *    would 403.
 *
 * GAP-PROCUREMENT-PLANNING-DETAIL-04 (feedback): these are 202-accepted async
 * commands (sendAccepted in planning/routes.ts) — on success we show an honest
 * "request accepted; status will update shortly" toast (NOT "approved!"), then
 * refresh so the real StatusPill reflects whatever the server actually did.
 */
export function PlanLifecycleActions({
  planId,
  status,
  submittedBy,
}: {
  planId: string;
  status: string;
  submittedBy?: string | null;
}) {
  const router = useRouter();
  const { userId, loaded } = useSessionIdentity();
  const { toast } = useToast();

  async function submit(reason?: string): Promise<void> {
    const res = await fetch(`/api/proxy/v1/procurement/plans/${planId}/submit`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(reason ? { notes: reason } : {}),
    });
    if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
  }

  async function approve(reason?: string): Promise<void> {
    const res = await fetch(`/api/proxy/v1/procurement/plans/${planId}/approve`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      // requireReason keeps Confirm disabled until a remark is typed, so
      // `reason` is non-empty in practice; it is recorded as approval notes.
      body: JSON.stringify({ notes: reason ?? "" }),
    });
    if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
  }

  async function reject(reason?: string): Promise<void> {
    const res = await fetch(`/api/proxy/v1/procurement/plans/${planId}/reject`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: reason ?? "" }),
    });
    if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
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
          onSuccess={() => {
            toast.info("Submission request accepted; status will update shortly.");
            router.refresh();
          }}
        />
      </div>
    );
  }

  if (status === "pending") {
    // Maker-checker: hide Approve from the submitter of this plan. Only hide
    // once the session has loaded AND we actually know the submitter — never
    // hide on uncertainty for a non-submitter (the server still enforces SoD).
    const isSubmitter = loaded && !!userId && !!submittedBy && userId === submittedBy;
    return (
      <div className="card pad" style={{ marginTop: 12, display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
        <ActionButton
          label="Reject"
          confirmTitle="Reject this plan?"
          confirmDescription="Rejecting returns the plan to the originating department for revision. A reason is mandatory and recorded in the audit trail."
          confirmLabel="Reject"
          danger
          requireReason
          reasonLabel="Reason for rejection (required)"
          onConfirm={reject}
          onSuccess={() => {
            toast.info("Rejection request accepted; status will update shortly.");
            router.refresh();
          }}
        />
        {isSubmitter ? (
          <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>
            You submitted this plan, so it must be approved by a different officer.
          </p>
        ) : (
          <ActionButton
            label="Approve"
            confirmTitle="Approve this plan?"
            confirmDescription="This approves the annual procurement plan and moves it into the ministry's approved plan register. A remark is required and recorded in the audit trail. This cannot be undone."
            confirmLabel="Approve"
            requireReason
            reasonLabel="Approval remarks (required)"
            onConfirm={approve}
            onSuccess={() => {
              toast.info("Approval request accepted; status will update shortly.");
              router.refresh();
            }}
          />
        )}
      </div>
    );
  }

  return null;
}
