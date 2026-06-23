"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { useOfflineResource } from "@/lib/sync/resource";
import { fetchOrQueue } from "@/lib/sync/requestQueue";

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

export function ProcurementApprovalsPanel() {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const { data: tasks, loading, offline, source, cachedAt, refresh } = useOfflineResource<unknown, WorkflowTask[]>(
    "procurement.approvals.tasks",
    "/v1/workflow/tasks?status=pending&limit=50",
    { map: toTasks, initialData: [] },
  );

  const complete = useCallback(
    async (taskId: string, decision: "approve" | "reject") => {
      setBusyId(taskId);
      setMessage("");
      try {
        const { response, queued } = await fetchOrQueue(`/v1/workflow/tasks/${taskId}/complete`, {
          method: "POST",
          body: { decision },
        });
        if (queued) {
          setMessage(`You're offline — ${decision} saved and will submit on reconnect.`);
          return;
        }
        const text = response ? await response.text() : "";
        if (!response || !response.ok) {
          setMessage(text || `${decision} failed (${response?.status ?? "network"})`);
          return;
        }
        setMessage(decision === "approve" ? "Approved via workflow." : "Rejected via workflow.");
        refresh();
        router.refresh();
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "Network error");
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

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div className="card-h">
        <h3>Workflow approval queue</h3>
        {cacheNote ? <span style={{ fontSize: 12, color: "#92400e" }}>{cacheNote}</span> : null}
      </div>
      {message ? <p className="pad" style={{ color: "#047857", fontSize: "0.875rem", paddingBottom: 0 }}>{message}</p> : null}
      <table className="tbl">
        <thead>
          <tr>
            <th>Task</th>
            <th>Reference</th>
            <th>Role</th>
            <th>Actions</th>
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
                      className="btn primary"
                      style={{ fontSize: "0.75rem", padding: "4px 10px", marginRight: 6 }}
                      disabled={busyId === task.id}
                      onClick={() => void complete(task.id, "approve")}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      style={{ fontSize: "0.75rem", padding: "4px 10px" }}
                      disabled={busyId === task.id}
                      onClick={() => void complete(task.id, "reject")}
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
    </div>
  );
}
