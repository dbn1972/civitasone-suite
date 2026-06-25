"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { useOfflineResource } from "@/lib/sync/resource";
import { fetchOrQueue } from "@/lib/sync/requestQueue";
import { ConfirmDialog } from "@/app/_components/ds";

type WorkflowTask = {
  id: string;
  instanceId: string;
  name: string;
  status: string;
  roleRef?: string | null;
  refType?: string | null;
  refId?: string | null;
};

const REF_TYPES = new Set(["procurement_indent", "procurement_po"]);

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
    return null;
  }

  const cacheNote =
    offline || source === "cache"
      ? `Saved queue${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — offline" : ""}.`
      : null;

  const dialogTask = pending?.task;
  const isReject = pending?.decision === "reject";

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div className="card-h">
        <h3>Workflow approval queue</h3>
        {cacheNote ? <span style={{ fontSize: 12, color: "#92400e" }}>{cacheNote}</span> : null}
      </div>
      {message ? (
        <p className="pad" role="status" aria-live="polite" style={{ color: "#047857", fontSize: "0.875rem", paddingBottom: 0 }}>{message}</p>
      ) : null}
      <table className="tbl">
        <thead>
          <tr>
            <th scope="col">Task</th>
            <th scope="col">Reference</th>
            <th scope="col">Role</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {loading && tasks.length === 0 ? (
            <tr><td colSpan={4} style={{ textAlign: "center", padding: 24, color: "#94a3b8" }}>Loading workflow tasks…</td></tr>
          ) : tasks.length === 0 ? (
            <tr><td colSpan={4} style={{ textAlign: "center", padding: 24, color: "#94a3b8" }}>No pending procurement workflow tasks</td></tr>
          ) : (
            tasks.map((task) => {
              const href = refLink(task);
              return (
                <tr key={task.id}>
                  <td>{task.name}</td>
                  <td>
                    {href ? (
                      <Link href={href} className="mono" style={{ color: "#4f46e5" }}>{task.refId}</Link>
                    ) : (
                      <span className="mono">{task.refId ?? "—"}</span>
                    )}
                  </td>
                  <td>{task.roleRef ?? "any"}</td>
                  <td>
                    <button
                      type="button"
                      className="btn primary sm"
                      style={{ marginRight: 6, minHeight: 36 }}
                      disabled={busyId === task.id}
                      onClick={() => { setMessage(""); setDialogError(undefined); setPending({ task, decision: "approve" }); }}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="btn ghost sm"
                      style={{ minHeight: 36 }}
                      disabled={busyId === task.id}
                      onClick={() => { setMessage(""); setDialogError(undefined); setPending({ task, decision: "reject" }); }}
                    >
                      Reject
                    </button>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>

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
