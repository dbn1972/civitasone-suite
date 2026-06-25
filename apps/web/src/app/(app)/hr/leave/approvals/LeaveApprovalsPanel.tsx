"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader, Card, DataTable, ConfirmDialog, EmptyState } from "../../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";

type WorkflowTask = {
  id: string;
  instanceId: string;
  name: string;
  status: string;
  roleRef?: string | null;
  refType?: string | null;
  refId?: string | null;
};

type LeaveDetail = {
  id: string;
  employeeName: string;
  leaveType: string;
  fromDate: string;
  toDate: string;
  days: number;
  reason?: string;
};

/** A workflow task joined with its leave-application context. */
type EnrichedTask = WorkflowTask & {
  employeeName: string;
  leaveType: string;
  dates: string;
  days: number | string;
  reason: string;
} & Record<string, unknown>;

type Decision = "approve" | "reject";

export function LeaveApprovalsPanel() {
  const router = useRouter();
  const [tasks, setTasks] = useState<WorkflowTask[]>([]);
  const [leaveById, setLeaveById] = useState<Record<string, LeaveDetail>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  // Dialog state
  const [pending, setPending] = useState<{ task: EnrichedTask; decision: Decision } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [taskRes, leaveRes] = await Promise.all([
        fetch("/api/proxy/v1/workflow/tasks?status=pending&limit=50"),
        fetch("/api/proxy/v1/hrms/leave-requests").catch(() => null),
      ]);

      if (!taskRes.ok) throw new Error((await taskRes.text()) || `Failed to load tasks (${taskRes.status})`);
      const taskBody = (await taskRes.json()) as { data?: WorkflowTask[] } | WorkflowTask[];
      const taskRows = Array.isArray(taskBody) ? taskBody : taskBody.data ?? [];
      setTasks(taskRows.filter((t) => t.refType === "leave_app" && t.status === "pending"));

      // Leave context is best-effort: a failure here still shows tasks (with IDs).
      if (leaveRes && leaveRes.ok) {
        const leaveBody = (await leaveRes.json()) as { data?: LeaveDetail[] } | LeaveDetail[];
        const leaveRows = Array.isArray(leaveBody) ? leaveBody : leaveBody.data ?? [];
        const map: Record<string, LeaveDetail> = {};
        for (const l of leaveRows) if (l?.id) map[l.id] = l;
        setLeaveById(map);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workflow tasks.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const enriched: EnrichedTask[] = useMemo(
    () =>
      tasks.map((t) => {
        const l = t.refId ? leaveById[t.refId] : undefined;
        return {
          ...t,
          employeeName: l?.employeeName ?? "Unknown employee",
          leaveType: l?.leaveType ?? t.name ?? "—",
          dates: l ? `${formatIndianDate(l.fromDate)} – ${formatIndianDate(l.toDate)}` : "—",
          days: l?.days ?? "—",
          reason: l?.reason ?? "—",
        };
      }),
    [tasks, leaveById],
  );

  async function complete(taskId: string, decision: Decision, reason?: string) {
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await fetch(`/api/proxy/v1/workflow/tasks/${taskId}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, reason }),
      });
      const text = await res.text();
      if (!res.ok) {
        setDialogError(text || `${decision} failed (${res.status})`);
        return;
      }
      setPending(null);
      setToast({
        tone: "good",
        text: decision === "approve" ? "Leave approved via workflow." : "Leave rejected.",
      });
      await loadTasks();
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const columns: {
    key: keyof EnrichedTask & string;
    label: string;
    align?: "left" | "right" | "center";
    sortable?: boolean;
    render?: (row: EnrichedTask) => React.ReactNode;
  }[] = [
    { key: "employeeName", label: "Employee" },
    { key: "leaveType", label: "Leave Type" },
    { key: "dates", label: "Dates" },
    { key: "days", label: "Days", align: "right" },
    { key: "reason", label: "Reason" },
    {
      key: "id",
      label: "Decision",
      sortable: false,
      render: (row) => (
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className="btn primary sm"
            style={{ minHeight: 44 }}
            onClick={() => {
              setDialogError(undefined);
              setPending({ task: row, decision: "approve" });
            }}
          >
            Approve
          </button>
          <button
            type="button"
            className="btn ghost sm"
            style={{ minHeight: 44 }}
            onClick={() => {
              setDialogError(undefined);
              setPending({ task: row, decision: "reject" });
            }}
          >
            Reject
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Leave Approvals"
        subtitle="Pending workflow tasks for leave applications. Completing a task runs the policy check and records the decision."
        back="/hr/leave"
        backLabel="Leave"
      />

      {toast && (
        <p role="status" aria-live="polite" className={`pill ${toast.tone}`} style={{ margin: "0 0 12px" }}>
          {toast.text}
        </p>
      )}

      <Card title="Pending Leave Approvals">
        {loading ? (
          <div style={{ padding: "40px 0", textAlign: "center", color: "var(--mut)" }} aria-live="polite">
            Loading workflow tasks…
          </div>
        ) : error ? (
          <EmptyState
            icon="⚠️"
            title="Could not load approvals"
            message={error}
            action={
              <button type="button" className="btn ghost" onClick={() => void loadTasks()}>
                Retry
              </button>
            }
          />
        ) : enriched.length === 0 ? (
          <EmptyState
            icon="✅"
            title="No pending approvals"
            message="There are no leave applications awaiting your decision."
          />
        ) : (
          <DataTable<EnrichedTask>
            columns={columns}
            rows={enriched}
            sortable
            filterable
            filterPlaceholder="Filter by employee, type or reason…"
            pageSize={15}
          />
        )}
      </Card>

      <ConfirmDialog
        open={pending !== null}
        title={pending?.decision === "approve" ? "Approve this leave application?" : "Reject this leave application?"}
        danger={pending?.decision === "reject"}
        requireReason
        reasonLabel={pending?.decision === "approve" ? "Approval remarks (maker-checker)" : "Reason for rejection"}
        confirmLabel={pending?.decision === "approve" ? "Approve leave" : "Reject leave"}
        busy={busy}
        errorMessage={dialogError}
        description={
          pending ? (
            <>
              {pending.decision === "approve" ? "Approve" : "Reject"} the{" "}
              <strong>{pending.task.leaveType}</strong> request from{" "}
              <strong>{pending.task.employeeName}</strong> for{" "}
              <strong>{pending.task.dates}</strong>
              {typeof pending.task.days === "number" ? ` (${pending.task.days} day(s))` : ""}.
              {pending.task.reason !== "—" && (
                <>
                  <br />
                  <span style={{ color: "var(--ink2)" }}>Reason given: {pending.task.reason}</span>
                </>
              )}
            </>
          ) : null
        }
        onConfirm={(reason) => pending && void complete(pending.task.id, pending.decision, reason)}
        onCancel={() => !busy && setPending(null)}
      />
    </>
  );
}
