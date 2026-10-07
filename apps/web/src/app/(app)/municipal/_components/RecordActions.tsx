"use client";

/**
 * GAP-MUNICIPAL-SERVICEKEY-APPLICATIONS-DETAIL-02 — officer workflow actions for
 * a municipal application. Rendered ONLY when the service config declares its
 * workflow endpoints AND the signed-in officer holds an officer role (the page
 * computes `canAct` server-side; the service re-enforces the role on every
 * route, so hiding here is UX, not the authority).
 *
 * Each action is a deliberate, confirmed, idempotent POST through the BFF proxy
 * to the service's existing per-service endpoint (approve/reject → decisionPath,
 * inspect → scrutinyPath). On success the page is refreshed so the status pill
 * and the History timeline reflect the new state.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, ConfirmDialog } from "@/app/_components/ds";
import { browserFetch } from "@/lib/api/browserClient";
import type { MunicipalWorkflowConfig } from "../_data/services";

type ActionKind = "approve" | "reject" | "inspect";

export function RecordActions({
  applicationId,
  status,
  workflow,
}: {
  applicationId: string;
  status: string;
  workflow: MunicipalWorkflowConfig;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<ActionKind | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const canDecide = workflow.decidableStatuses.includes(status);
  const canInspect = workflow.inspectableStatuses.includes(status);

  if (!canDecide && !canInspect) {
    return (
      <Card title="Officer actions">
        <div className="pad">
          <p style={{ fontSize: 13, color: "var(--ink2)", margin: 0 }}>
            No actions are available from the current status ({status}).
          </p>
        </div>
      </Card>
    );
  }

  async function run(kind: ActionKind): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      let res: Response;
      if (kind === "inspect") {
        res = await browserFetch(workflow.scrutinyPath, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ applicationId, scrutinyType: "field_inspection" }),
        });
      } else {
        res = await browserFetch(workflow.decisionPath, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            applicationId,
            decision: kind === "approve" ? "approved" : "rejected",
            ...(reason.trim() ? { reason: reason.trim() } : {}),
          }),
        });
      }
      if (!res.ok) {
        setError("The action could not be completed. Check your permissions and the application status, then try again.");
        setBusy(false);
        return;
      }
      setOpen(null);
      setReason("");
      router.refresh();
    } catch {
      setError("The action could not be completed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Officer actions">
      <div className="pad" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {canInspect && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setOpen("inspect")}>
            Start inspection
          </Button>
        )}
        {canDecide && (
          <>
            <Button variant="primary" size="sm" disabled={busy} onClick={() => setOpen("approve")}>
              Approve
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setOpen("reject")}>
              Reject
            </Button>
          </>
        )}
      </div>

      <ConfirmDialog
        open={open === "inspect"}
        title="Start inspection?"
        confirmLabel="Confirm — start inspection"
        busy={busy}
        errorMessage={error}
        description={<>Move this application into scrutiny / field inspection. This is recorded in the application history.</>}
        onConfirm={() => void run("inspect")}
        onCancel={() => !busy && setOpen(null)}
      />

      <ConfirmDialog
        open={open === "approve"}
        title="Approve this application?"
        confirmLabel="Confirm approve"
        busy={busy}
        errorMessage={error}
        description={
          <div style={{ display: "grid", gap: 8 }}>
            <p style={{ margin: 0 }}>Approving changes the application status and records the decision in the history. This is an official act.</p>
            <label style={{ fontSize: 12.5, fontWeight: 600 }}>
              Reason (optional)
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                style={{ width: "100%", marginTop: 4, padding: 8, borderRadius: 8, border: "1px solid var(--line)" }}
              />
            </label>
          </div>
        }
        onConfirm={() => void run("approve")}
        onCancel={() => !busy && setOpen(null)}
      />

      <ConfirmDialog
        open={open === "reject"}
        title="Reject this application?"
        confirmLabel="Confirm reject"
        danger
        busy={busy}
        errorMessage={error}
        description={
          <div style={{ display: "grid", gap: 8 }}>
            <p style={{ margin: 0 }}>Rejecting changes the application status and records the decision in the history. Record a clear reason.</p>
            <label style={{ fontSize: 12.5, fontWeight: 600 }}>
              Reason
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                style={{ width: "100%", marginTop: 4, padding: 8, borderRadius: 8, border: "1px solid var(--line)" }}
              />
            </label>
          </div>
        }
        onConfirm={() => void run("reject")}
        onCancel={() => !busy && setOpen(null)}
      />
    </Card>
  );
}
