"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type WorkflowTask = {
  id: string;
  name: string;
  status: string;
  roleRef?: string | null;
  refType?: string | null;
  refId?: string | null;
};

export function EstabApprovalsPanel() {
  const router = useRouter();
  const [tasks, setTasks] = useState<WorkflowTask[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/proxy/v1/workflow/tasks?status=pending&limit=50");
      if (!res.ok) throw new Error(await res.text());
      const body = await res.json() as { data?: WorkflowTask[] } | WorkflowTask[];
      const rows = Array.isArray(body) ? body : (body.data ?? []);
      setTasks(rows.filter((t) => t.refType === "estab_file" && t.status === "pending"));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadTasks(); }, [loadTasks]);

  async function complete(taskId: string, decision: "approve" | "reject") {
    setBusyId(taskId);
    setMessage("");
    try {
      const res = await fetch(`/api/proxy/v1/workflow/tasks/${taskId}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) {
        setMessage(await res.text() || `${decision} failed`);
        return;
      }
      const task = tasks.find((t) => t.id === taskId);
      const role = task?.roleRef ?? "";
      if (decision === "approve") {
        if (role.includes("deputy_secretary") || task?.name?.toLowerCase().includes("deputy")) {
          setMessage("Final approval — yellow note promoted to green (DSC e-Signed).");
        } else {
          setMessage(`Approved at ${task?.name ?? role} — forwarded to next level.`);
        }
      } else {
        setMessage("Rejected — noting returned to draft on file.");
      }
      await loadTasks();
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Network error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div className="card-h"><h3>File noting approval queue</h3></div>
      {message ? <p className="pad" style={{ color: "#047857", fontSize: "0.875rem", paddingBottom: 0 }}>{message}</p> : null}
      <table className="tbl">
        <thead>
          <tr><th>Task</th><th>File</th><th>Role</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={4} style={{ textAlign: "center", padding: 24, color: "#94a3b8" }}>Loading…</td></tr>
          ) : tasks.length === 0 ? (
            <tr><td colSpan={4} style={{ textAlign: "center", padding: 24, color: "#94a3b8" }}>No pending file noting approvals</td></tr>
          ) : (
            tasks.map((task) => (
              <tr key={task.id}>
                <td>{task.name}</td>
                <td>
                  {task.refId ? (
                    <Link href={`/estab/files/${task.refId}`} className="mono" style={{ color: "#4f46e5" }}>
                      {task.refId.slice(0, 8)}…
                    </Link>
                  ) : "—"}
                </td>
                <td>{task.roleRef ?? "estab_deputy_secretary"}</td>
                <td>
                  <button type="button" className="btn primary" style={{ fontSize: "0.75rem", padding: "4px 10px", marginRight: 6 }} disabled={busyId === task.id} onClick={() => void complete(task.id, "approve")}>
                    Approve &amp; e-Sign
                  </button>
                  <button type="button" className="btn ghost" style={{ fontSize: "0.75rem", padding: "4px 10px" }} disabled={busyId === task.id} onClick={() => void complete(task.id, "reject")}>
                    Reject
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
