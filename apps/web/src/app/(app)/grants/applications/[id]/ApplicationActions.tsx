"use client";
/**
 * ApplicationActions — COMP-012.
 *
 * Replaces the 5 dead anchor links (assign-reviewer, score, approve, reject,
 * withdraw) that pointed at application sub-routes which were never built.
 * All 5 actions PATCH the existing, validated grant-service routes directly
 * (grant-service/src/modules/application/routes.ts), following the
 * UserManagementPage.tsx modal+fetch convention already used for Suspend:
 * open a dialog, submit, router.refresh() on success so the page re-renders
 * with the application's new status.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/app/_components/ds";
import {
  assignReviewer,
  scoreApplication,
  approveApplication,
  rejectApplication,
  withdrawApplication,
  type ScoreApplicationRequest,
  type ApproveApplicationRequest,
} from "@/lib/grants/application";
import { ScoreApplicationDialog } from "./ScoreApplicationDialog";
import { ApproveApplicationDialog } from "./ApproveApplicationDialog";

type ActionKey = "assign-reviewer" | "score" | "approve" | "reject" | "withdraw";

export function ApplicationActions({ applicationId, actions }: { applicationId: string; actions: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<ActionKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const canAssign = actions.includes("assign-reviewer");
  const canScore = actions.includes("score");
  const canApprove = actions.includes("approve");
  const canReject = actions.includes("reject");
  const canWithdraw = actions.includes("withdraw");

  if (!canAssign && !canScore && !canApprove && !canReject && !canWithdraw) return null;

  function close() {
    if (busy) return;
    setOpen(null);
    setError("");
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      setOpen(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not complete this action.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {canAssign && (
          <button type="button" className="btn" onClick={() => setOpen("assign-reviewer")}>
            Assign Reviewer
          </button>
        )}
        {canScore && (
          <button type="button" className="btn" onClick={() => setOpen("score")}>
            Submit Evaluation
          </button>
        )}
        {canApprove && (
          <button type="button" className="btn primary" onClick={() => setOpen("approve")}>
            Approve Application
          </button>
        )}
        {canReject && (
          <button type="button" className="btn" style={{ color: "var(--bad)" }} onClick={() => setOpen("reject")}>
            Reject
          </button>
        )}
        {canWithdraw && (
          <button type="button" className="btn" style={{ color: "var(--warn)" }} onClick={() => setOpen("withdraw")}>
            Withdraw
          </button>
        )}
      </div>
      <p style={{ fontSize: 12, color: "var(--ink2)", marginTop: 8 }}>
        Actions are async — changes take effect after processing (usually within seconds).
      </p>

      <ConfirmDialog
        open={open === "assign-reviewer"}
        title="Assign reviewer"
        description="Enter the reviewer's reference/ID to assign this application for review."
        confirmLabel="Assign"
        requireReason
        reasonLabel="Reviewer reference"
        maxReasonLength={128}
        busy={busy}
        errorMessage={error || undefined}
        onConfirm={(reviewerRef) =>
          void run(() => assignReviewer(applicationId, { reviewerRef: (reviewerRef ?? "").trim() }))
        }
        onCancel={close}
      />

      <ConfirmDialog
        open={open === "reject"}
        title="Reject application"
        description="This application will be marked rejected. Provide a reason."
        confirmLabel="Reject"
        danger
        requireReason
        reasonLabel="Reason"
        minReasonLength={10}
        maxReasonLength={1000}
        busy={busy}
        errorMessage={error || undefined}
        onConfirm={(reason) => void run(() => rejectApplication(applicationId, { reason: (reason ?? "").trim() }))}
        onCancel={close}
      />

      <ConfirmDialog
        open={open === "withdraw"}
        title="Withdraw application"
        description="This application will be withdrawn. Provide a reason."
        confirmLabel="Withdraw"
        requireReason
        reasonLabel="Reason"
        minReasonLength={5}
        maxReasonLength={1000}
        busy={busy}
        errorMessage={error || undefined}
        onConfirm={(reason) => void run(() => withdrawApplication(applicationId, { reason: (reason ?? "").trim() }))}
        onCancel={close}
      />

      <ScoreApplicationDialog
        open={open === "score"}
        busy={busy}
        errorMessage={error}
        onCancel={close}
        onSubmit={(req: ScoreApplicationRequest) => void run(() => scoreApplication(applicationId, req))}
      />

      <ApproveApplicationDialog
        open={open === "approve"}
        busy={busy}
        errorMessage={error}
        onCancel={close}
        onSubmit={(req: ApproveApplicationRequest) => void run(() => approveApplication(applicationId, req))}
      />
    </>
  );
}
