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
import { Button, ConfirmDialog } from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";
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

export function ApplicationActions({
  applicationId,
  actions,
  canApprove = true,
  canReview = true,
  isOwnApplication = false,
  requestedMinor,
  minMinor,
  maxMinor,
}: {
  applicationId: string;
  actions: string[];
  /** GAP-GRANTS-APPLICATIONS-DETAIL-01: session holds a grants approver role. */
  canApprove?: boolean;
  /** session holds a reviewer role (score/assign). */
  canReview?: boolean;
  /** GAP-GRANTS-APPLICATIONS-DETAIL-02: viewer is the submitter → maker-checker
   *  blocks them from scoring/approving/rejecting their own application. */
  isOwnApplication?: boolean;
  /** GAP-GRANTS-APPLICATIONS-DETAIL-04: approve-dialog context (paise). */
  requestedMinor?: number | null;
  minMinor?: number | null;
  maxMinor?: number | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<ActionKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // A maker action on your OWN application is blocked (server also 403s with
  // SOD_VIOLATION); withdraw stays available to the submitter.
  const makerAllowed = !isOwnApplication;
  const canAssign = actions.includes("assign-reviewer") && canReview && makerAllowed;
  const canScore = actions.includes("score") && canReview && makerAllowed;
  const canApproveAction = actions.includes("approve") && canApprove && makerAllowed;
  const canReject = actions.includes("reject") && canApprove && makerAllowed;
  const canWithdraw = actions.includes("withdraw");

  if (!canAssign && !canScore && !canApproveAction && !canReject && !canWithdraw) {
    // GAP-GRANTS-APPLICATIONS-DETAIL-02: explain why no maker control is shown.
    if (isOwnApplication && (actions.includes("approve") || actions.includes("score"))) {
      return (
        <p style={{ fontSize: 13, color: "var(--ink2)" }}>
          You submitted this application, so you cannot score, approve or reject it (separation of duties).
        </p>
      );
    }
    return null;
  }

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
    } catch {
      // Never surface the raw backend `code: message` on a money-critical action.
      const human = toHumanError("save", { area: "application action" });
      setError(`${human.what} ${human.next}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {canAssign && (
          <Button type="button" variant="ghost" onClick={() => setOpen("assign-reviewer")}>
            Assign Reviewer
          </Button>
        )}
        {canScore && (
          <Button type="button" variant="ghost" onClick={() => setOpen("score")}>
            Submit Evaluation
          </Button>
        )}
        {canApproveAction && (
          <Button type="button" variant="primary" onClick={() => setOpen("approve")}>
            Approve Application
          </Button>
        )}
        {canReject && (
          <Button type="button" variant="danger" onClick={() => setOpen("reject")}>
            Reject
          </Button>
        )}
        {canWithdraw && (
          <Button type="button" variant="ghost" style={{ color: "var(--warn)" }} onClick={() => setOpen("withdraw")}>
            Withdraw
          </Button>
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
        requestedMinor={requestedMinor}
        minMinor={minMinor}
        maxMinor={maxMinor}
        onCancel={close}
        onSubmit={(req: ApproveApplicationRequest) => void run(() => approveApplication(applicationId, req))}
      />
    </>
  );
}
