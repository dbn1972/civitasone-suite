"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type WorkflowTask = {
  id: string;
  instanceId: string;
  name: string;
  status: string;
  roleRef?: string | null;
  refType?: string | null;
  refId?: string | null;
};

export function LeaveApprovalsPanel() {
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
      setTasks(rows.filter((t) => t.refType === "leave_app" && t.status === "pending"));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  async function complete(taskId: string, decision: "approve" | "reject") {
    setBusyId(taskId);
    setMessage("");
    try {
      const res = await fetch(`/api/proxy/v1/workflow/tasks/${taskId}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const text = await res.text();
      if (!res.ok) {
        setMessage(text || `${decision} failed (${res.status})`);
        return;
      }
      setMessage(decision === "approve" ? "Leave approved via workflow." : "Leave rejected.");
      await loadTasks();
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Network error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-5xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/hr" className="hover:text-slate-900">HR</Link>
          <span className="mx-2">/</span>
          <Link href="/hr/leave" className="hover:text-slate-900">Leave</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Approvals</span>
        </nav>

        <header>
          <h1 className="text-3xl font-semibold text-slate-900">Leave Approvals</h1>
          <p className="mt-1 text-sm text-slate-600">
            Pending workflow tasks for leave applications. Completing a task runs policy check and approves leave.
          </p>
        </header>

        {message ? <p className="text-sm text-emerald-700">{message}</p> : null}

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-4 py-3 text-left">Task</th>
                <th className="px-4 py-3 text-left">Leave App ID</th>
                <th className="px-4 py-3 text-left">Role</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">Loading workflow tasks…</td></tr>
              ) : tasks.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">No pending leave approval tasks</td></tr>
              ) : (
                tasks.map((task) => (
                  <tr key={task.id} className="border-t border-slate-200">
                    <td className="px-4 py-3">{task.name}</td>
                    <td className="px-4 py-3 font-mono text-xs">{task.refId ?? "—"}</td>
                    <td className="px-4 py-3">{task.roleRef ?? "any"}</td>
                    <td className="px-4 py-3">{task.status}</td>
                    <td className="px-4 py-3 space-x-2">
                      <button
                        type="button"
                        disabled={busyId === task.id}
                        onClick={() => void complete(task.id, "approve")}
                        className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
                      >
                        {busyId === task.id ? "…" : "Approve"}
                      </button>
                      <button
                        type="button"
                        disabled={busyId === task.id}
                        onClick={() => void complete(task.id, "reject")}
                        className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                      >
                        Reject
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
