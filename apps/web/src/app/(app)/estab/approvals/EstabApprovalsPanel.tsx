"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { DataTable, ActionButton, EmptyState, ErrorState } from "../../../_components/ds";
import { toHumanError } from "@/lib/messages";

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
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch("/api/proxy/v1/workflow/tasks?status=pending&limit=50");
      if (!res.ok) throw new Error(await res.text());
      const body = await res.json() as { data?: WorkflowTask[] } | WorkflowTask[];
      const rows = Array.isArray(body) ? body : (body.data ?? []);
      setTasks(rows.filter((t) => t.refType === "estab_file" && t.status === "pending"));
    } catch {
      // A failed load must not read as "No approvals pending" — an approver
      // would wrongly believe there is nothing to sign.
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadTasks(); }, [loadTasks]);

  const complete = useCallback(
    async (taskId: string, decision: "approve" | "reject", reason?: string) => {
      const res = await fetch(`/api/proxy/v1/workflow/tasks/${taskId}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, reason }),
      });
      if (!res.ok) {
        throw new Error((await res.text()) || `${decision} failed`);
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
    },
    [tasks, loadTasks, router],
  );

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div className="card-h"><h3>File noting approval queue</h3></div>
      <div role="status" aria-live="polite">
        {message ? <p className="pad" style={{ color: "var(--good)", fontSize: "0.875rem", paddingBottom: 0 }}>{message}</p> : null}
      </div>
      {loading ? (
        <p className="pad" style={{ textAlign: "center", color: "#94a3b8" }}>Loading…</p>
      ) : loadError ? (
        <div className="pad"><ErrorState error={toHumanError("load", { area: "approval queue" })} onRetry={() => void loadTasks()} /></div>
      ) : tasks.length === 0 ? (
        <EmptyState icon="✅" title="No approvals pending" message="File notings awaiting your approval will appear here." />
      ) : (
        <DataTable<WorkflowTask>
          columns={[
            { key: "name", label: "Task" },
            {
              key: "refId",
              label: "File",
              render: (task) =>
                task.refId ? (
                  <Link href={`/estab/files/${task.refId}`} className="mono" style={{ color: "#4f46e5" }}>
                    {task.refId.slice(0, 8)}…
                  </Link>
                ) : (
                  <>—</>
                ),
            },
            { key: "roleRef", label: "Role", render: (task) => <>{task.roleRef ?? "estab_deputy_secretary"}</> },
            {
              key: "id",
              label: "Actions",
              sortable: false,
              render: (task) => (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <ActionButton
                    label="Approve & e-Sign"
                    className="btn primary"
                    confirmTitle="Approve and e-Sign this noting?"
                    confirmDescription="This records your DSC e-signature on the file noting and forwards it up the SO → US → DS chain. On final approval the yellow note is promoted to a green note. This cannot be undone."
                    confirmLabel="Approve & e-Sign"
                    requireReason
                    reasonLabel="Approval remarks"
                    onConfirm={(reason) => complete(task.id, "approve", reason)}
                  />
                  <ActionButton
                    label="Reject"
                    className="btn ghost"
                    danger
                    confirmTitle="Reject this noting?"
                    confirmDescription="This returns the noting to draft on the file. The maker will need to revise and resubmit."
                    confirmLabel="Reject"
                    requireReason
                    reasonLabel="Reason for rejection"
                    onConfirm={(reason) => complete(task.id, "reject", reason)}
                  />
                </div>
              ),
            },
          ]}
          rows={tasks}
        />
      )}
    </div>
  );
}
