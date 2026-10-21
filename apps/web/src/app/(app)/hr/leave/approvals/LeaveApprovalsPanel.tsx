"use client";

import { UserFacingError } from "@/lib/userFacingError";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, DataTable, ConfirmDialog, EmptyState, ErrorState, Button } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { formatIndianDate } from "@/lib/formatters";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";

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
  /** False when this row's leave-application detail failed to load (the
   * enrichment fetch failed entirely, or simply didn't include this row —
   * e.g. a delegated/second-level approver outside the applicant's direct
   * reporting line after the backend's read-scoping fix). Approve/Reject
   * must be disabled for that row specifically: "Unknown employee" alone
   * previously left the decision fully clickable, a blind-approval risk. */
  hasLeaveDetail: boolean;
} & Record<string, unknown>;

type Decision = "approve" | "reject";

/** Tasks requested per page. */
const TASK_PAGE_SIZE = 50;
/**
 * Safety bound on the paging loop below (50 x 20 = 1,000 pending tasks): an
 * inbox this deep still renders a visible "showing the first N" notice rather
 * than looping forever or pretending to be complete.
 */
const MAX_TASK_PAGES = 20;

type TaskPage = {
  data?: WorkflowTask[];
  pagination?: { hasMore?: boolean; total?: number; cursor?: string };
};

/**
 * GAP-HR-LEAVE-APPROVALS-02: every pending leave_app task, following the
 * server's pagination until it is exhausted. workflow-service filters by
 * `refType` in SQL (before the page window), so normally this is one page; the
 * loop and the client-side refType check are the safety net for a server that
 * ignores the filter (other modules' tasks fill the first pages) -- the old
 * single fetch of the first 50 tasks of ALL types silently dropped leave
 * approvals past that window and then said "No pending approvals".
 */
type ResponseErrorHandler = (res: Response) => Promise<never>;
type PendingLeaveTasks = { tasks: WorkflowTask[]; truncated: boolean; checked: number };

async function fetchPendingLeaveTasks(signal: AbortSignal | undefined, onResponseError: ResponseErrorHandler): Promise<PendingLeaveTasks> {
  const tasks: WorkflowTask[] = [];
  let offset = 0;
  let checked = 0;
  for (let page = 0; page < MAX_TASK_PAGES; page++) {
    const res = await fetch(
      `/api/proxy/v1/workflow/tasks?status=pending&refType=leave_app&limit=${TASK_PAGE_SIZE}&offset=${offset}`,
      { signal },
    );
    if (!res.ok) return onResponseError(res);
    const body = (await res.json()) as TaskPage | WorkflowTask[];
    const rows = Array.isArray(body) ? body : body.data ?? [];
    const pagination = Array.isArray(body) ? undefined : body.pagination;
    checked += rows.length;
    for (const wt of rows) if (wt.refType === "leave_app" && wt.status === "pending") tasks.push(wt);
    const next = pagination?.cursor !== undefined ? Number(pagination.cursor) : offset + rows.length;
    // Done when the server says nothing is left (or gives us nothing to advance on).
    if (!pagination?.hasMore || rows.length === 0 || !Number.isFinite(next) || next <= offset) {
      return { tasks, truncated: false, checked };
    }
    offset = next;
  }
  return { tasks, truncated: true, checked };
}

export function LeaveApprovalsPanel() {
  const t = useTranslations("leaveApprovals");
  const [tasks, setTasks] = useState<WorkflowTask[]>([]);
  const [leaveById, setLeaveById] = useState<Record<string, LeaveDetail>>({});
  // GAP-HR-LEAVE-APPROVALS-06: leave details already fetched, and the ids whose
  // enrichment request has already SUCCEEDED (even if the row was legitimately
  // absent from the response, e.g. scoped out for a delegated approver) --
  // a background re-sync only ever requests ids it has not resolved yet.
  const leaveByIdRef = useRef<Record<string, LeaveDetail>>({});
  const enrichedIdsRef = useRef<Set<string>>(new Set());
  // Only the newest load may write state (overlapping loads: a decision's
  // silent re-sync can land while an earlier load is still paging).
  const loadSeqRef = useRef(0);
  // GAP-HR-LEAVE-APPROVALS-02: true when the paging safety bound was hit with
  // more tasks still on the server -- the list is then NOT complete.
  const [truncated, setTruncated] = useState(false);
  const [checkedTasks, setCheckedTasks] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"api" | "error">("api");
  // GAP-HR-LEAVE-APPROVALS-01: distinct from the main task-load `error` above
  // — the TASKS load can succeed while the leave-detail ENRICHMENT call
  // fails (it was always a separate, best-effort fetch). Previously that
  // failure was invisible: every row silently fell back to "Unknown
  // employee" with (now, since the disabled-button fix already in place)
  // no way for the approver to tell "nobody applied" apart from "the
  // context just failed to load, retry".
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  // Dialog state
  const [pending, setPending] = useState<{ task: EnrichedTask; decision: Decision } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const formError = useFormError("leave application");

  const loadTasks = useCallback(async (signal?: AbortSignal, silent = false) => {
    const seq = ++loadSeqRef.current;
    if (!silent) setLoading(true);
    setError(null);
    setEnrichError(null);
    try {
      // GAP-HR-LEAVE-APPROVALS-02: workflow-service filters by refType in SQL
      // and reports hasMore/total/cursor; follow it until exhausted. The
      // client-side leave_app check inside stays as the safety net.
      const { tasks: leaveTasks, truncated: more, checked } = await fetchPendingLeaveTasks(signal, async (res) => {
        const resolved = await formError.fromResponse(res, "load");
        setSource("error");
        throw UserFacingError.from(resolved);
      });
      if (seq !== loadSeqRef.current) return;
      setTasks(leaveTasks);
      setTruncated(more);
      setCheckedTasks(checked);

      // GAP-HR-LEAVE-APPROVALS-04: fetch exactly the applications these
      // visible tasks reference (ids=...) instead of the caller's entire
      // tenant/manager-scoped page — narrows what this panel ever
      // requests, on top of (not instead of) the role-based scope GET
      // /leave-requests already enforces server-side.
      // GAP-HR-LEAVE-APPROVALS-06: ...and only the ones not already resolved,
      // so a background re-sync after a decision re-requests nothing.
      const ids = Array.from(new Set(leaveTasks.map((wt) => wt.refId).filter((id): id is string => !!id)));
      const wanted = ids.filter((id) => !enrichedIdsRef.current.has(id));
      if (wanted.length === 0) {
        setLeaveById({ ...leaveByIdRef.current });
        return;
      }
      const leaveRes = await fetch(`/api/proxy/v1/hrms/leave-requests?ids=${wanted.map(encodeURIComponent).join(",")}`, { signal }).catch(() => null);
      if (seq !== loadSeqRef.current) return;
      // Leave context is best-effort: a failure here still shows tasks (with
      // IDs) — Approve/Reject are disabled per-row instead (hasLeaveDetail).
      if (leaveRes && leaveRes.ok) {
        const leaveBody = (await leaveRes.json()) as { data?: LeaveDetail[] } | LeaveDetail[];
        const leaveRows = Array.isArray(leaveBody) ? leaveBody : leaveBody.data ?? [];
        for (const l of leaveRows) if (l?.id) leaveByIdRef.current[l.id] = l;
        for (const id of wanted) enrichedIdsRef.current.add(id);
        setLeaveById({ ...leaveByIdRef.current });
      } else if (leaveRes) {
        const resolved = await formError.fromResponse(leaveRes, "load");
        setLeaveById({ ...leaveByIdRef.current });
        setEnrichError(resolved.message);
      } else {
        setLeaveById({ ...leaveByIdRef.current });
        setEnrichError(formError.fromException("load", new TypeError("no response")).message);
      }
    } catch (e) {
      // A signal abort (component unmounted, e.g. the user navigated away
      // while this mount-time load was in flight) rejects the fetch with an
      // AbortError -- that's an intentional teardown, not a real load
      // failure, and must not paint this now-gone panel's error state onto
      // whatever the user navigated to instead.
      if (e instanceof Error && e.name === "AbortError") return;
      if (seq !== loadSeqRef.current) return;
      setSource("error");
      setError(formError.fromException("load", e).message);
    } finally {
      if (!silent) setLoading(false);
    }
    // formError.fromResponse/fromException/clear are stable (useCallback'd on
    // a fixed `area` string inside useFormError) even though the wrapping
    // `formError` object literal isn't, so omitting it here is safe and
    // avoids re-creating loadTasks (and re-running its effect) every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- formError.fromResponse/fromException/clear are stable (useCallback'd on a fixed area string in useFormError); the wrapping object is recreated every render but isn't read here.
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadTasks(controller.signal);
    return () => controller.abort();
  }, [loadTasks]);

  const enriched: EnrichedTask[] = useMemo(
    () =>
      tasks.map((wt) => {
        const l = wt.refId ? leaveById[wt.refId] : undefined;
        return {
          ...wt,
          employeeName: l?.employeeName ?? t("unknownEmployee"),
          leaveType: l?.leaveType ?? wt.name ?? "—",
          dates: l ? `${formatIndianDate(l.fromDate)} – ${formatIndianDate(l.toDate)}` : "—",
          days: l?.days ?? "—",
          reason: l?.reason ?? "—",
          hasLeaveDetail: l != null,
        };
      }),
    [tasks, leaveById, t],
  );

  async function complete(task: EnrichedTask, decision: Decision, reason?: string) {
    setBusy(true);
    setDialogError(undefined);
    try {
      // GAP-HR-LEAVE-APPROVALS-03: ONE atomic call. workflow-service's
      // completeTaskBody now accepts the optional `reason` and persists it
      // with the decision (task history) in the same transaction; for a
      // rejection it is also carried to the applicant's rejection notice.
      // This replaces the old second, non-atomic POST /workflow/comments
      // (internal-only, could fail after the decision had already committed).
      const trimmed = reason?.trim();
      const res = await fetch(`/api/proxy/v1/workflow/tasks/${task.id}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(trimmed ? { decision, reason: trimmed } : { decision }),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setDialogError(resolved.message);
        return;
      }

      setPending(null);
      setToast({ tone: "good", text: decision === "approve" ? t("toastApproved") : t("toastRejected") });
      // GAP-HR-LEAVE-APPROVALS-06: remove the decided row immediately
      // instead of waiting on a full refetch, drop the unconditional
      // router.refresh() (this route has no server-rendered data depending
      // on it — approvals/page.tsx does no data fetching of its own), and
      // don't re-request /leave-requests at all (reuse leaveById; the
      // decided task is gone from `tasks`, so its detail row is simply
      // never rendered again). Re-sync `tasks` from the server in the
      // background (silent=true: no full-page loading flicker) only to
      // pick up any newly-arrived pending task — if the server later
      // rejects the decision, this background refresh restores the row.
      setTasks((prev) => prev.filter((wt) => wt.id !== task.id));
      void loadTasks(undefined, true);
    } catch (caught) {
      setDialogError(formError.fromException("save", caught).message);
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
    { key: "employeeName", label: t("colEmployee") },
    { key: "leaveType", label: t("colLeaveType") },
    { key: "dates", label: t("colDates") },
    { key: "days", label: t("colDays"), align: "right" },
    { key: "reason", label: t("colReason") },
    {
      key: "id",
      label: t("colDecision"),
      sortable: false,
      render: (row) => (
        <div style={{ display: "flex", gap: 8 }}>
          <Button
            size="sm"
            style={{ minHeight: 44 }}
            disabled={!row.hasLeaveDetail}
            title={!row.hasLeaveDetail ? t("cannotDecideTitle") : undefined}
            onClick={() => {
              setDialogError(undefined);
              setPending({ task: row, decision: "approve" });
            }}
          >
            {t("approve")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            style={{ minHeight: 44 }}
            disabled={!row.hasLeaveDetail}
            title={!row.hasLeaveDetail ? t("cannotDecideTitle") : undefined}
            onClick={() => {
              setDialogError(undefined);
              setPending({ task: row, decision: "reject" });
            }}
          >
            {t("reject")}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      {toast && (
        <p role="status" aria-live="polite" className={`pill ${toast.tone}`} style={{ margin: "0 0 12px" }}>
          {toast.text}
        </p>
      )}

      <DataSourceBadge source={source} />
      {/* GAP-HR-LEAVE-APPROVALS-01: the enrichment call is separate from the
          task load above (it can fail on its own) — shown as its own
          dismissable-by-retry banner, not silently absorbed into "Unknown
          employee" text with no indication anything went wrong. */}
      {enrichError && (
        <div style={{ padding: "10px 14px", marginBottom: 12, borderRadius: 8, background: "var(--warnbg)", border: "1px solid var(--warn)", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }} role="alert">
          <span aria-hidden="true">⚠️</span>
          <span>{t("enrichErrorMessage")}</span>
          <Button variant="ghost" size="sm" style={{ marginInlineStart: "auto" }} onClick={() => void loadTasks()}>
            {t("retry")}
          </Button>
        </div>
      )}
      <Card title={loading || error ? t("panelTitle") : t("panelTitleWithCount", { count: tasks.length })}>
        {loading ? (
          <div style={{ padding: "40px 0", textAlign: "center", color: "var(--mut)" }} aria-live="polite">
            {t("loadingTasks")}
          </div>
        ) : error ? (
          <ErrorState
            error={{ what: t("loadErrorTitle"), next: error, actions: ["retry"] }}
            onRetry={() => void loadTasks()}
          />
        ) : enriched.length === 0 && truncated ? (
          // GAP-HR-LEAVE-APPROVALS-02: more tasks exist than were searched --
          // never claim "No pending approvals" for an incomplete search.
          <div role="alert" style={{ padding: "16px 20px", fontSize: 13 }}>
            {t("truncatedEmptyMessage", { checked: checkedTasks })}
          </div>
        ) : enriched.length === 0 ? (
          <EmptyState
            icon="✅"
            title={t("emptyTitle")}
            message={t("emptyMessage")}
          />
        ) : (
          <>
          {truncated && (
            <p role="status" style={{ margin: "0 0 12px", padding: "10px 14px", borderRadius: 8, background: "var(--warnbg)", fontSize: 13 }}>
              {t("truncatedNotice", { shown: enriched.length })}
            </p>
          )}
          <DataTable<EnrichedTask>
            columns={columns}
            rows={enriched}
            sortable
            filterable
            filterPlaceholder={t("filterPlaceholder")}
            pageSize={15}
          />
          </>
        )}
      </Card>

      <ConfirmDialog
        open={pending !== null}
        title={pending?.decision === "approve" ? t("approveDialogTitle") : t("rejectDialogTitle")}
        danger={pending?.decision === "reject"}
        // GAP-HR-LEAVE-APPROVALS-05 (decision): approve's remark is friction
        // for a routine, low-risk decision — only reject (which needs a
        // reason the applicant/audit trail can point to) requires one.
        requireReason={pending?.decision === "reject"}
        optionalReason={pending?.decision === "approve"}
        reasonLabel={pending?.decision === "approve" ? t("approveRemarksLabel") : t("rejectReasonLabel")}
        confirmLabel={pending?.decision === "approve" ? t("approveConfirmLabel") : t("rejectConfirmLabel")}
        busy={busy}
        errorMessage={dialogError}
        description={
          pending ? (
            <>
              {t.rich("description", {
                b: (chunks) => <strong>{chunks}</strong>,
                decision: pending.decision === "approve" ? t("approve") : t("reject"),
                leaveType: pending.task.leaveType,
                employeeName: pending.task.employeeName,
                dates: pending.task.dates,
                dayCount:
                  typeof pending.task.days === "number"
                    ? t("dayCountSuffix", { count: pending.task.days })
                    : "",
              })}
              {pending.task.reason !== "—" && (
                <>
                  <br />
                  <span style={{ color: "var(--ink2)" }}>{t("reasonGiven", { reason: pending.task.reason })}</span>
                </>
              )}
            </>
          ) : null
        }
        onConfirm={(reason) => pending && void complete(pending.task, pending.decision, reason)}
        onCancel={() => !busy && setPending(null)}
      />
    </>
  );
}
