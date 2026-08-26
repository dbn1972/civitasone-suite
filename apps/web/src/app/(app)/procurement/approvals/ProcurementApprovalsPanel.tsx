"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { useOfflineResource } from "@/lib/sync/resource";
import { fetchOrQueue } from "@/lib/sync/requestQueue";
import { ConfirmDialog, DataTable, EmptyState } from "@/app/_components/ds";

type WorkflowTask = {
  id: string;
  instanceId: string;
  name: string;
  status: string;
  roleRef?: string | null;
  refType?: string | null;
  refId?: string | null;
};

// L1/L2/L3 fix: this was ["procurement_indent", "procurement_po"] only. The
// backend also raises workflow approval tasks with refType "procurement_plan"
// (services/procurement-service/src/modules/planning/consumer.ts, on plan
// submit) and "procurement_po_amendment" (.../po/amendment-consumer.ts, on
// amendment request) — see planningRoutes' submit/approve/reject and
// poAmendmentRoutes' approve/reject. Because this filter ran before those two
// refTypes existed, any pending Annual Procurement Plan or PO Amendment
// approval was silently dropped from "Workflow approval queue": it never
// rendered, so an approver had no way to see or act on it, and the queue's
// "No pending tasks" empty state was a lie whenever one of these was
// outstanding. `complete()` below already POSTs generically to
// /v1/workflow/tasks/:id/complete regardless of refType, so no other change
// is needed to make Approve/Reject actually work for these task types.
const REF_TYPES = new Set(["procurement_indent", "procurement_po", "procurement_plan", "procurement_po_amendment"]);

function toTasks(payload: unknown): WorkflowTask[] {
  const rows: WorkflowTask[] = Array.isArray(payload)
    ? (payload as WorkflowTask[])
    : ((payload as { data?: WorkflowTask[] })?.data ?? []);
  return rows.filter((t) => t.refType && REF_TYPES.has(t.refType) && t.status === "pending");
}

type Pending = { task: WorkflowTask; decision: "approve" | "reject" };

export function ProcurementApprovalsPanel() {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [dialogError, setDialogError] = useState<string | undefined>(undefined);

  const { data: tasks, loading, offline, source, cachedAt, refresh } = useOfflineResource<unknown, WorkflowTask[]>(
    "procurement.approvals.tasks",
    "/v1/workflow/tasks?status=pending&limit=50",
    { map: toTasks, initialData: [] },
  );

  const complete = useCallback(
    async (task: WorkflowTask, decision: "approve" | "reject", reason?: string) => {
      setBusyId(task.id);
      setMessage("");
      setDialogError(undefined);
      try {
        const { response, queued } = await fetchOrQueue(`/v1/workflow/tasks/${task.id}/complete`, {
          method: "POST",
          // `reason` is captured for the audit trail (mandatory on reject);
          // the workflow service stores it on the task-completion event.
          body: decision === "reject" ? { decision, reason } : { decision },
        });
        if (queued) {
          setPending(null);
          setMessage(`You're offline — ${decision} saved and will submit on reconnect.`);
          return;
        }
        const text = response ? await response.text() : "";
        if (!response || !response.ok) {
          const msg = text || `${decision} failed (${response?.status ?? "network"})`;
          setDialogError(msg);
          throw new Error(msg);
        }
        setPending(null);
        setMessage(decision === "approve" ? "Approved via workflow." : "Rejected via workflow.");
        refresh();
        router.refresh();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Network error";
        setDialogError(msg);
        throw err instanceof Error ? err : new Error(msg);
      } finally {
        setBusyId(null);
      }
    },
    [refresh, router],
  );

  function refLink(task: WorkflowTask): string | null {
    if (task.refType === "procurement_indent" && task.refId) return `/procurement/indents/${task.refId}`;
    if (task.refType === "procurement_po" && task.refId) return `/procurement/orders/${task.refId}`;
    if (task.refType === "procurement_plan" && task.refId) return `/procurement/planning/${task.refId}`;
    // procurement_po_amendment: refId is the amendment's own id, not the PO's —
    // there is no per-amendment detail route to link to, so fall back to plain
    // text (same as any other unrecognised refType) rather than link somewhere
    // wrong. The row is still fully actionable via Approve/Reject below.
    return null;
  }

  const cacheNote =
    offline || source === "cache"
      ? `Saved queue${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — offline" : ""}.`
      : null;

  const dialogTask = pending?.task;
  const isReject = pending?.decision === "reject";

  // Build table rows as plain records for DataTable
  type TaskRow = {
    id: string;
    name: string;
    refId: string;
    roleRef: string;
    _task: WorkflowTask;
  };

  const tableRows: TaskRow[] = tasks.map((task) => ({
    id: task.id,
    name: task.name,
    refId: task.refId ?? "—",
    roleRef: task.roleRef ?? "any",
    _task: task,
  }));

  const columns: { key: keyof TaskRow; label: string; render?: (row: TaskRow) => React.ReactNode }[] = [
    { key: "name", label: "Task" },
    {
      key: "refId",
      label: "Reference",
      render: (row) => {
        const href = refLink(row._task);
        return href ? (
          <Link href={href} className="mono" style={{ color: "#4f46e5" }}>{row.refId}</Link>
        ) : (
          <span className="mono">{row.refId}</span>
        );
      },
    },
    { key: "roleRef", label: "Role" },
    {
      key: "id",
      label: "Actions",
      render: (row) => (
        <>
          <button
            type="button"
            className="btn primary sm"
            style={{ marginRight: 6, minHeight: 36 }}
            disabled={busyId === row.id}
            onClick={() => { setMessage(""); setDialogError(undefined); setPending({ task: row._task, decision: "approve" }); }}
          >
            Approve
          </button>
          <button
            type="button"
            className="btn ghost sm"
            style={{ minHeight: 36 }}
            disabled={busyId === row.id}
            onClick={() => { setMessage(""); setDialogError(undefined); setPending({ task: row._task, decision: "reject" }); }}
          >
            Reject
          </button>
        </>
      ),
    },
  ];

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div className="card-h">
        <h3>Workflow approval queue</h3>
        {cacheNote ? <span style={{ fontSize: 12, color: "#92400e" }}>{cacheNote}</span> : null}
      </div>
      {message ? (
        <p className="pad" role="status" aria-live="polite" style={{ color: "#047857", fontSize: "0.875rem", paddingBottom: 0 }}>{message}</p>
      ) : null}

      {loading && tasks.length === 0 ? (
        <p className="pad" style={{ textAlign: "center", color: "#94a3b8" }}>Loading workflow tasks…</p>
      ) : tasks.length === 0 ? (
        <EmptyState icon="✅" title="No pending tasks" message="No pending procurement workflow tasks at this time." />
      ) : (
        <DataTable<TaskRow>
          columns={columns}
          rows={tableRows}
          pageSize={25}
        />
      )}

      <ConfirmDialog
        open={pending !== null}
        title={isReject ? "Reject this approval?" : "Approve this approval?"}
        description={
          dialogTask
            ? isReject
              ? <>Rejecting <strong>{dialogTask.name}</strong> ({dialogTask.refId ?? "—"}) returns it to the originator. A reason is mandatory and recorded in the audit trail.</>
              : <>This approves <strong>{dialogTask.name}</strong> ({dialogTask.refId ?? "—"}) and advances the workflow. This action cannot be undone.</>
            : undefined
        }
        confirmLabel={isReject ? "Reject" : "Approve"}
        danger={isReject}
        requireReason={isReject}
        reasonLabel="Reason for rejection (required)"
        busy={busyId !== null}
        errorMessage={dialogError}
        onConfirm={(reason) => {
          if (!dialogTask || !pending) return;
          void complete(dialogTask, pending.decision, reason).catch(() => {});
        }}
        onCancel={() => { if (busyId === null) { setPending(null); setDialogError(undefined); } }}
      />
    </div>
  );
}
