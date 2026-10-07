"use client";

import { userFacingErrorFromResponse } from "@/lib/api/userFacingFromResponse";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { DataTable, ActionButton, EmptyState, ErrorState } from "../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import { APPROVAL_RECORDS_COPY, APPROVE_BUTTON_LABEL } from "../_shared/signatureCopy";

type WorkflowTask = {
  id: string;
  name: string;
  status: string;
  roleRef?: string | null;
  refType?: string | null;
  refId?: string | null;
};

/** File metadata resolved per estab task so the approver sees context, not a UUID slice. */
type FileMeta = { fileNo?: string; subject?: string };

const PAGE_SIZE = 50;
const MAX_PAGES = 10; // bound the walk; estab tasks beyond 500 pending get a notice.

/** Map a raw workflow role code to a friendly label (GAP-ESTAB-APPROVALS-04). */
function roleLabel(roleRef: string | null | undefined): string {
  if (!roleRef) return "—";
  return roleRef.replace(/^estab_/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function EstabApprovalsPanel() {
  const router = useRouter();
  const [tasks, setTasks] = useState<WorkflowTask[]>([]);
  const [files, setFiles] = useState<Record<string, FileMeta>>({});
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadTasks = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError(false);
    setTruncated(false);
    try {
      // GAP-ESTAB-APPROVALS-01: the workflow API has no refType filter, so page
      // through the pending queue (offset cursor) collecting estab_file tasks
      // instead of filtering a single limit=50 page client-side — otherwise a
      // backlog of other modules' tasks pushes estab approvals off page 1 and
      // the approver sees a false "No approvals pending".
      const collected: WorkflowTask[] = [];
      let offset = 0;
      let page = 0;
      let more = true;
      while (more && page < MAX_PAGES) {
        const res = await fetch(
          `/api/proxy/v1/workflow/tasks?status=pending&limit=${PAGE_SIZE}&offset=${offset}`,
          { signal },
        );
        if (!res.ok) throw await userFacingErrorFromResponse(res, "load");
        const body = (await res.json()) as
          | { data?: WorkflowTask[]; pagination?: { hasMore?: boolean } }
          | WorkflowTask[];
        const rows = Array.isArray(body) ? body : body.data ?? [];
        const hasMore = Array.isArray(body) ? rows.length === PAGE_SIZE : Boolean(body.pagination?.hasMore);
        for (const t of rows) {
          if (t.refType === "estab_file" && t.status === "pending") collected.push(t);
        }
        offset += rows.length;
        page += 1;
        more = hasMore && rows.length > 0;
      }
      if (more) setTruncated(true); // hit the page cap with more pending still queued
      setTasks(collected);

      // GAP-ESTAB-APPROVALS-03: resolve file no + subject for each task so the
      // approver has context (and the dialog can name the item).
      const refIds = [...new Set(collected.map((t) => t.refId).filter((v): v is string => Boolean(v)))];
      const metas = await Promise.all(
        refIds.map(async (id) => {
          try {
            const r = await fetch(`/api/proxy/v1/estab/files/${id}`, { signal });
            if (!r.ok) return [id, {} as FileMeta] as const;
            const b = (await r.json()) as { data?: { fileNo?: string; subject?: string } };
            return [id, { fileNo: b.data?.fileNo, subject: b.data?.subject }] as const;
          } catch {
            return [id, {} as FileMeta] as const;
          }
        }),
      );
      setFiles(Object.fromEntries(metas));
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadTasks(controller.signal);
    return () => controller.abort();
  }, [loadTasks]);

  const complete = useCallback(
    async (taskId: string, decision: "approve" | "reject", reason?: string) => {
      setActionError("");
      const res = await fetch(`/api/proxy/v1/workflow/tasks/${taskId}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, reason }),
      });
      if (!res.ok) {
        // GAP-ESTAB-APPROVALS-06: throw a clerk-safe message (not raw res.text()).
        throw await userFacingErrorFromResponse(res, "save");
      }
      const task = tasks.find((t) => t.id === taskId);
      const fileNo = task?.refId ? files[task.refId]?.fileNo : undefined;
      const ref = fileNo ? ` on file ${fileNo}` : "";
      // GAP-ESTAB-APPROVALS-05: the complete endpoint returns 202 Accepted with
      // no finality flag, so the UI cannot honestly say "final approval" vs
      // "forwarded". Removed the role/name string-matching guess; state the
      // decision that was recorded and let the refreshed queue show the result.
      if (decision === "approve") {
        setMessage(`Approval recorded${ref}. The noting moves to the next step in the chain.`);
      } else {
        setMessage(`Rejection recorded${ref}. The noting is returned to draft on the file.`);
      }
      await loadTasks();
      router.refresh();
    },
    [tasks, files, loadTasks, router],
  );

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div className="card-h"><h3>File noting approval queue</h3></div>
      <div role="status" aria-live="polite">
        {message ? (
          <div className="pad" style={{ display: "flex", gap: 8, alignItems: "center", paddingBottom: 0 }}>
            <p style={{ color: "var(--good)", fontSize: "0.875rem", margin: 0 }}>{message}</p>
            <button type="button" className="btn ghost" style={{ padding: "2px 8px" }} onClick={() => setMessage("")}>Dismiss</button>
          </div>
        ) : null}
        {actionError ? <p className="pad" style={{ color: "var(--bad)", fontSize: "0.875rem", paddingBottom: 0 }}>{actionError}</p> : null}
      </div>
      {truncated ? (
        <p className="pad" style={{ color: "var(--warn)", fontSize: "0.8125rem", paddingBottom: 0 }}>
          Showing the first {MAX_PAGES * PAGE_SIZE} pending tasks. More may exist — clear some approvals and refresh.
        </p>
      ) : null}
      {loading ? (
        <p className="pad" style={{ textAlign: "center", color: "var(--mut)" }}>Loading…</p>
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
                    {files[task.refId]?.fileNo ?? `${task.refId.slice(0, 8)}…`}
                  </Link>
                ) : (
                  <>—</>
                ),
            },
            {
              key: "refType",
              label: "Subject",
              sortable: false,
              render: (task) => <>{(task.refId && files[task.refId]?.subject) || "—"}</>,
            },
            { key: "roleRef", label: "Role", render: (task) => <>{roleLabel(task.roleRef)}</> },
            {
              key: "id",
              label: "Actions",
              sortable: false,
              render: (task) => {
                const meta = task.refId ? files[task.refId] : undefined;
                const named = meta?.fileNo ? `file ${meta.fileNo}${meta.subject ? ` — ${meta.subject}` : ""}` : "this noting";
                return (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <ActionButton
                      label={APPROVE_BUTTON_LABEL}
                      className="btn primary"
                      confirmTitle={`Approve ${named}?`}
                      confirmDescription={APPROVAL_RECORDS_COPY}
                      confirmLabel={APPROVE_BUTTON_LABEL}
                      requireReason
                      reasonLabel="Approval remarks"
                      onConfirm={(reason) => complete(task.id, "approve", reason)}
                    />
                    <ActionButton
                      label="Reject"
                      className="btn ghost"
                      danger
                      confirmTitle={`Reject ${named}?`}
                      confirmDescription="This returns the noting to draft on the file. The maker will need to revise and resubmit."
                      confirmLabel="Reject"
                      requireReason
                      reasonLabel="Reason for rejection"
                      onConfirm={(reason) => complete(task.id, "reject", reason)}
                    />
                  </div>
                );
              },
            },
          ]}
          rows={tasks}
        />
      )}
    </div>
  );
}
