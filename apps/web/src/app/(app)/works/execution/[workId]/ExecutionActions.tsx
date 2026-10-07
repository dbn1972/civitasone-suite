"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog, useToast, Card, Button } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";

interface ExecutionActionsProps {
  workId: string;
  /** UI gate: whether this session may certify completion / close the work.
   *  The server routes stay authoritative (403); this only hides the controls. */
  canManage?: boolean;
  /** Open issue count for the precondition warning; null when unknown (fetch failed). */
  openIssues?: number | null;
}

type ClosureType = "closed" | "dropped" | "completion";

export function ExecutionActions({ workId, canManage = true, openIssues = null }: ExecutionActionsProps) {
  const router = useRouter();
  const { toast } = useToast();

  // ── Physical Completion Certificate ────────────────────────────────────────
  const [completionDate, setCompletionDate] = useState("");
  const [physDialog, setPhysDialog] = useState(false);
  const [physBusy, setPhysBusy] = useState(false);
  const [physError, setPhysError] = useState("");
  const physFormError = useFormError("physical completion certificate");

  async function handlePhysicalComplete() {
    setPhysBusy(true);
    setPhysError("");
    physFormError.clear();
    try {
      const body: Record<string, unknown> = { workId };
      if (completionDate) body.completionDate = completionDate;
      const res = await fetch("/api/proxy/v1/works/execution/physical-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const resolved = await physFormError.fromResponse(res, "save");
        setPhysError(resolved.message);
        return;
      }
      toast.success("Work physically marked as complete.");
      setPhysDialog(false);
      setTimeout(() => router.refresh(), 600);
    } catch (caught) {
      setPhysError(physFormError.fromException("save", caught).message);
    } finally {
      setPhysBusy(false);
    }
  }

  // ── Work Closure ───────────────────────────────────────────────────────────
  const [closureType, setClosureType] = useState<ClosureType>("completion");
  const [closureReason, setClosureReason] = useState("");
  const [closureDialog, setClosureDialog] = useState(false);
  const [closureBusy, setClosureBusy] = useState(false);
  const [closureError, setClosureError] = useState("");
  const closureFormError = useFormError("work closure");

  async function handleClosure() {
    setClosureBusy(true);
    setClosureError("");
    closureFormError.clear();
    try {
      const res = await fetch("/api/proxy/v1/works/execution/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workId, closureType, ...(closureReason.trim() ? { remarks: closureReason.trim() } : {}) }),
      });
      if (!res.ok) {
        const resolved = await closureFormError.fromResponse(res, "save");
        setClosureError(resolved.message);
        return;
      }
      toast.success(`Work closed (${closureType}).`);
      setClosureDialog(false);
      setTimeout(() => router.refresh(), 600);
    } catch (caught) {
      setClosureError(closureFormError.fromException("save", caught).message);
    } finally {
      setClosureBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 16 }}>
      {!canManage ? (
        <Card title="Completion & Closure">
          <p style={{ padding: "16px 20px", margin: 0, fontSize: 13, color: "var(--muted)" }}>
            Only authorised officers can certify physical completion or close this work.
          </p>
        </Card>
      ) : (
        <>
          {typeof openIssues === "number" && openIssues > 0 && (
            <div role="alert" style={{ padding: "10px 14px", borderRadius: 8, background: "#fffaeb", border: "1px solid #fde68a", color: "#92400e", fontSize: 13 }}>
              ⚠️ This work has {openIssues} open issue{openIssues === 1 ? "" : "s"}. Resolve them before closing the work.
            </div>
          )}
      <Card title="Physical Completion Certificate">
        <div
          style={{
            padding: "16px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 12,
              alignItems: "end",
              maxWidth: 560,
            }}
          >
            <div>
              <label
                htmlFor="execution-completion-date"
                style={{
                  display: "block",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--ink3)",
                  marginBottom: 4,
                }}
              >
                Completion Date (optional)
              </label>
              <input
                id="execution-completion-date"
                type="date"
                className="input"
                value={completionDate}
                onChange={(e) => setCompletionDate(e.target.value)}
              />
            </div>
            <Button
              onClick={() => setPhysDialog(true)}
              variant="primary"
              style={{ minHeight: 36 }}
            >
              Mark Complete
            </Button>
          </div>
          {physError && (
            <p style={{ color: "var(--red)", fontSize: 13, margin: 0 }}>{physError}</p>
          )}
        </div>
      </Card>

      {/* ── Work Closure ────────────────────────────────────────────────────── */}
      <Card title="Work Closure">
        <div
          style={{
            padding: "16px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 12,
              alignItems: "end",
              maxWidth: 560,
            }}
          >
            <div>
              <label
                htmlFor="execution-closure-type"
                style={{
                  display: "block",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--ink3)",
                  marginBottom: 4,
                }}
              >
                Closure Type
              </label>
              <select
                id="execution-closure-type"
                className="input"
                value={closureType}
                onChange={(e) => setClosureType(e.target.value as ClosureType)}
              >
                <option value="completion">Completion</option>
                <option value="closed">Closed</option>
                <option value="dropped">Dropped</option>
              </select>
            </div>
            <Button
              onClick={() => setClosureDialog(true)}
              variant="primary"
              style={{ minHeight: 36 }}
            >
              Close Work
            </Button>
          </div>
          {closureType === "dropped" && (
            <div>
              <label htmlFor="execution-closure-reason" style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--ink3)", marginBottom: 4 }}>
                Reason for dropping (required)
              </label>
              <textarea
                id="execution-closure-reason"
                className="input"
                value={closureReason}
                maxLength={2048}
                onChange={(e) => setClosureReason(e.target.value)}
                style={{ minHeight: 64, width: "100%", maxWidth: 560, resize: "vertical" }}
                placeholder="Why is this work being dropped?"
              />
            </div>
          )}
          {closureError && (
            <p style={{ color: "var(--red)", fontSize: 13, margin: 0 }}>{closureError}</p>
          )}
        </div>
      </Card>
      </>
      )}

      {/* Dialogs */}
      <ConfirmDialog
        open={physDialog}
        title="Mark Work as Physically Complete"
        description={`This will record physical completion${
          completionDate ? ` on ${completionDate}` : ""
        }. This action cannot be undone.`}
        confirmLabel="Mark Complete"
        busy={physBusy}
        errorMessage={physError || undefined}
        onConfirm={handlePhysicalComplete}
        onCancel={() => {
          setPhysDialog(false);
          setPhysError("");
        }}
      />
      <ConfirmDialog
        open={closureDialog}
        title="Close Work"
        description={`This will permanently close this work as "${closureType}". This action cannot be undone.`}
        confirmLabel="Close Work"
        danger
        busy={closureBusy}
        blockConfirm={closureType === "dropped" && !closureReason.trim()}
        errorMessage={closureError || undefined}
        onConfirm={handleClosure}
        onCancel={() => {
          setClosureDialog(false);
          setClosureError("");
        }}
      />
    </div>
  );
}
