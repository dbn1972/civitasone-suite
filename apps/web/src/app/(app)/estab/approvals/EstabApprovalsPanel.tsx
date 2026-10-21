"use client";

import { userFacingErrorFromResponse } from "@/lib/api/userFacingFromResponse";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DataTable, ActionButton, EmptyState, ErrorState } from "../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import { formatIndianDate } from "@/lib/formatters";
import { useEstabT } from "@/lib/estab/useEstabT";
import { startBoundedPoll } from "@/lib/estab/boundedPoll";
import { APPROVAL_RECORDS_COPY, APPROVE_BUTTON_LABEL } from "../_shared/signatureCopy";
import { latestNoteOf, noteExcerpt, type NoteSheetLike, type LatestNote } from "./latestNote";
import { outcomeFromInstanceTasks, type InstanceTask, type ApprovalOutcome } from "./approvalOutcome";

type WorkflowTask = {
  id: string;
  name: string;
  status: string;
  roleRef?: string | null;
  refType?: string | null;
  refId?: string | null;
  /** The workflow instance the task belongs to; used to see where an approval moved the noting. */
  instanceId?: string | null;
};

/** File metadata resolved per estab task so the approver sees context, not a UUID slice. */
type FileMeta = { fileNo?: string; subject?: string; latestNote?: LatestNote };

/** A queue row: the task plus the file context it resolves to. */
type ApprovalRow = WorkflowTask & { fileNo: string; subject: string; noteText: string };

const PAGE_SIZE = 50;
const MAX_PAGES = 10; // bound the walk; estab tasks beyond 500 pending get a notice.

/** Characters of the latest note shown in a queue row, and in the approve dialog. */
const ROW_NOTE_CHARS = 140;
const DIALOG_NOTE_CHARS = 600;

/** Map a raw workflow role code to a friendly label (GAP-ESTAB-APPROVALS-04). */
function roleLabel(roleRef: string | null | undefined): string {
  if (!roleRef) return "—";
  return roleRef.replace(/^estab_/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function EstabApprovalsPanel() {
  const router = useRouter();
  const t = useEstabT("estabApprovals");
  const [tasks, setTasks] = useState<WorkflowTask[]>([]);
  const [files, setFiles] = useState<Record<string, FileMeta>>({});
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);
  const cancels = useRef<Array<() => void>>([]);
  const mounted = useRef(true);

  // Stop any outcome poll when the page goes away.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancels.current.forEach((cancel) => cancel());
      cancels.current = [];
    };
  }, []);

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
        for (const task of rows) {
          if (task.refType === "estab_file" && task.status === "pending") collected.push(task);
        }
        offset += rows.length;
        page += 1;
        more = hasMore && rows.length > 0;
      }
      if (more) setTruncated(true); // hit the page cap with more pending still queued
      setTasks(collected);

      // GAP-ESTAB-APPROVALS-03: resolve file no, subject and the latest note for each task so the
      // approver decides with context (and the dialog can name the item). GET /v1/estab/files/:id
      // returns the file as a bare object (not wrapped in { data }), with its note sheets.
      const refIds = [...new Set(collected.map((task) => task.refId).filter((v): v is string => Boolean(v)))];
      const metas = await Promise.all(
        refIds.map(async (id) => {
          try {
            const r = await fetch(`/api/proxy/v1/estab/files/${encodeURIComponent(id)}`, { signal });
            if (!r.ok) return [id, {} as FileMeta] as const;
            const b = (await r.json()) as { fileNo?: unknown; subject?: unknown; noteSheets?: NoteSheetLike[] };
            const latest = latestNoteOf(b.noteSheets);
            const meta: FileMeta = {
              ...(typeof b.fileNo === "string" ? { fileNo: b.fileNo } : {}),
              ...(typeof b.subject === "string" ? { subject: b.subject } : {}),
              ...(latest ? { latestNote: latest } : {}),
            };
            return [id, meta] as const;
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

  /**
   * GAP-ESTAB-APPROVALS-05: say where an approval moved the noting from what the workflow
   * recorded, never from a role or task name. The workflow lists every task of the instance
   * (any role): once this task shows completed, another pending task means the noting was
   * forwarded to that role, and none means this was the last step. Until then it is still
   * being applied, so the poll is bounded and ends with an honest "not applied yet".
   */
  const watchOutcome = useCallback(
    (task: WorkflowTask, target: string) => {
      if (!task.instanceId) return;
      const instanceId = task.instanceId;
      const cancel = startBoundedPoll<ApprovalOutcome>({
        check: async () => {
          const res = await fetch(`/api/proxy/v1/workflow/tasks?instanceId=${encodeURIComponent(instanceId)}&limit=50`);
          if (!res.ok) return null;
          const body = (await res.json()) as { data?: InstanceTask[] } | InstanceTask[];
          return outcomeFromInstanceTasks(Array.isArray(body) ? body : body.data ?? [], task.id);
        },
        onResolved: (outcome) => {
          if (!mounted.current) return;
          if (outcome.kind === "final") setMessage(t("approvalFinal", { target }));
          else if (outcome.roles.length > 0) setMessage(t("approvalForwarded", { target, roles: outcome.roles.map(roleLabel).join(", ") }));
          else setMessage(t("approvalForwardedAny", { target }));
        },
        onExhausted: () => {
          if (mounted.current) setMessage(t("approvalNotApplied", { target }));
        },
      });
      cancels.current.push(cancel);
    },
    [t],
  );

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
      const task = tasks.find((x) => x.id === taskId);
      const fileNo = task?.refId ? files[task.refId]?.fileNo : undefined;
      const target = fileNo ? t("targetFile", { fileNo }) : t("targetNoting");
      if (decision === "approve") {
        // The complete endpoint returns 202 Accepted with no outcome, so say what is known now and
        // then replace it with what the workflow recorded (see watchOutcome).
        setMessage(task?.instanceId ? t("approvalSubmitted", { target }) : t("approvalRecorded", { target }));
        if (task) watchOutcome(task, target);
      } else {
        setMessage(t("rejectionRecorded", { target }));
      }
      await loadTasks();
      router.refresh();
    },
    [tasks, files, loadTasks, router, watchOutcome, t],
  );

  const rows = useMemo<ApprovalRow[]>(
    () =>
      tasks.map((task) => {
        const meta = task.refId ? files[task.refId] : undefined;
        return {
          ...task,
          fileNo: meta?.fileNo ?? (task.refId ? `${task.refId.slice(0, 8)}…` : "—"),
          subject: meta?.subject ?? "—",
          noteText: meta?.latestNote ? noteExcerpt(meta.latestNote.content, ROW_NOTE_CHARS) : "",
        };
      }),
    [tasks, files],
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
        <DataTable<ApprovalRow>
          columns={[
            { key: "name", label: "Task" },
            {
              key: "fileNo",
              label: "File",
              render: (row) =>
                row.refId ? (
                  <Link href={`/estab/files/${encodeURIComponent(row.refId)}`} className="mono" style={{ color: "var(--indigo)" }}>
                    {row.fileNo}
                  </Link>
                ) : (
                  <>—</>
                ),
            },
            { key: "subject", label: "Subject" },
            {
              key: "noteText",
              label: t("colLatestNote"),
              sortable: false,
              render: (row) => {
                const note = row.refId ? files[row.refId]?.latestNote : undefined;
                return (
                  <div style={{ display: "grid", gap: 2, fontSize: "0.8125rem" }}>
                    {note ? (
                      <>
                        <span>{row.noteText}</span>
                        <span className="mut" style={{ fontSize: "0.75rem" }}>
                          {[note.author, note.at ? formatIndianDate(note.at) : null].filter(Boolean).join(" · ")}
                        </span>
                      </>
                    ) : (
                      <span className="mut">{t("noNoteAvailable")}</span>
                    )}
                    {row.refId ? (
                      <Link href={`/estab/files/${encodeURIComponent(row.refId)}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--indigo)", fontSize: "0.75rem" }}>
                        {t("openNoteNewTab")}
                      </Link>
                    ) : null}
                  </div>
                );
              },
            },
            { key: "roleRef", label: "Role", render: (row) => <>{roleLabel(row.roleRef)}</> },
            {
              key: "id",
              label: "Actions",
              sortable: false,
              render: (row) => {
                const meta = row.refId ? files[row.refId] : undefined;
                const named = meta?.fileNo ? `file ${meta.fileNo}${meta.subject ? ` — ${meta.subject}` : ""}` : "this noting";
                const note = meta?.latestNote;
                return (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <ActionButton
                      label={APPROVE_BUTTON_LABEL}
                      className="btn primary"
                      confirmTitle={`Approve ${named}?`}
                      confirmDescription={
                        <>
                          {note ? (
                            <blockquote style={{ margin: "0 0 8px", padding: "6px 10px", borderInlineStart: "3px solid var(--line)", fontSize: "0.8125rem" }}>
                              <strong>{t("dialogLatestNote")}</strong>
                              <br />
                              {noteExcerpt(note.content, DIALOG_NOTE_CHARS)}
                            </blockquote>
                          ) : null}
                          {APPROVAL_RECORDS_COPY}
                        </>
                      }
                      confirmLabel={APPROVE_BUTTON_LABEL}
                      requireReason
                      reasonLabel="Approval remarks"
                      onConfirm={(reason) => complete(row.id, "approve", reason)}
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
                      onConfirm={(reason) => complete(row.id, "reject", reason)}
                    />
                  </div>
                );
              },
            },
          ]}
          rows={rows}
        />
      )}
    </div>
  );
}
