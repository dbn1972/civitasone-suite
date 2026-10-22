"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useOfflineResource } from "@/lib/sync/resource";
import { fetchOrQueue } from "@/lib/sync/requestQueue";
import { ConfirmDialog, DataTable, EmptyState, ErrorState, Button } from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";
import { formatMoney } from "@/lib/formatters";

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

// GAP-PROCUREMENT-APPROVALS-01: the queue used to fetch
// /v1/workflow/tasks?status=pending&limit=50 across ALL modules and filter to
// procurement refTypes client-side. With >50 pending tasks tenant-wide, any
// procurement task past the cut-off never rendered and "No pending tasks" read
// as all-clear. Now (a) workflow-service filters by the four procurement
// refTypes in SQL (repeated refType params, applied BEFORE limit/offset), (b)
// the queue pages through the result with "Load more" until the server reports
// no further page (pagination.hasMore), and (c) whenever more pages exist the
// panel says so -- including when none of the rows loaded so far is a
// procurement task, so a truncated list is never mistaken for an empty queue.
// The client-side refType filter stays as a defence for a service that ignores
// the param (it then returns a superset, and paging still reaches the rest).
const TASKS_LIMIT = 200;
const TASKS_PATH = `/v1/workflow/tasks?status=pending&limit=${TASKS_LIMIT}${[...REF_TYPES]
  .map((t) => `&refType=${encodeURIComponent(t)}`)
  .join("")}`;

/**
 * `rawCount` is the number of rows the server returned BEFORE the client-side
 * refType filter -- it is the next page's `offset`. `maybeIncomplete` is true
 * when further pages exist (the server's own `pagination.hasMore`; a bare-array
 * response falls back to "the page was full").
 */
type TasksResult = { tasks: WorkflowTask[]; maybeIncomplete: boolean; rawCount: number };

// GAP-PROCUREMENT-APPROVALS-05/07: what procurement-service knows about the
// document a task is about (value, requester, parent PO for an amendment).
type RefSummary = { refType: string; refId: string; label: string; amountMinor: string; requestedBy?: string; poId?: string };
type SummaryState = "idle" | "loading" | "ready" | "error";
const SUMMARY_REF_TYPES = new Set(["procurement_indent", "procurement_po", "procurement_po_amendment"]);
const SUMMARY_BATCH = 50;

function rawTaskRows(payload: unknown): WorkflowTask[] {
  return Array.isArray(payload)
    ? (payload as WorkflowTask[])
    : ((payload as { data?: WorkflowTask[] })?.data ?? []);
}

function hasMorePages(payload: unknown, rows: WorkflowTask[]): boolean {
  const pagination = (payload as { pagination?: { hasMore?: unknown } } | null | undefined)?.pagination;
  if (pagination && typeof pagination.hasMore === "boolean") return pagination.hasMore;
  // No pagination envelope: if the raw (pre-filter) response filled the page,
  // more pending tasks may exist beyond it that we never saw.
  return rows.length >= TASKS_LIMIT;
}

function toTasks(payload: unknown): TasksResult {
  const rows = rawTaskRows(payload);
  const tasks = rows.filter((t) => t.refType && REF_TYPES.has(t.refType) && t.status === "pending");
  return { tasks, maybeIncomplete: hasMorePages(payload, rows), rawCount: rows.length };
}

type Pending = { task: WorkflowTask; decision: "approve" | "reject" };

/**
 * GAP-PROCUREMENT-APPROVALS-02 / GAP-PROCUREMENT-ORDERS-DETAIL-01 (role gate):
 * mirrors workflow-service tasks/commands.ts -- completing a task needs the
 * task's `roleRef` (a task with no roleRef is unrestricted; super_admin may act
 * on any). Anyone else gets 403 ROLE_NOT_AUTHORIZED, so the queue shows who the
 * task is assigned to instead of an Approve/Reject pair that cannot work.
 * (An active delegation also lets the server accept the action; delegated
 * approvers act from the workflow inbox.)
 */
export function canActOnTask(task: { roleRef?: string | null }, viewerRoles: readonly string[]): boolean {
  if (viewerRoles.includes("super_admin")) return true;
  return !task.roleRef || viewerRoles.includes(task.roleRef);
}

export function ProcurementApprovalsPanel({ viewerRoles = [] }: { viewerRoles?: readonly string[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [dialogError, setDialogError] = useState<string | undefined>(undefined);

  // L3 fix: `error` was never destructured, so a genuine fetch failure (not
  // offline, just failed, and nothing cached yet) fell straight through to
  // the tasks.length===0 branch below and rendered "No pending tasks" — the
  // same "lying empty state" bug class already fixed for DataSourceBadge
  // elsewhere in this cluster, here hiding real outstanding approvals from an
  // officer behind what looks like a clean inbox.
  const { data: result, loading, offline, source, cachedAt, error, refresh } = useOfflineResource<unknown, TasksResult>(
    // v2: the cached shape gained `rawCount` (the next page's offset); an entry
    // saved by the previous shape must not be read back as this one.
    "procurement.approvals.tasks.v2",
    TASKS_PATH,
    { map: toTasks, initialData: { tasks: [], maybeIncomplete: false, rawCount: 0 } },
  );
  const tw = useTranslations("procurement.w2b.approvals");

  // Pages after the first ("Load more"). The first page comes from the offline
  // resource above; later pages are fetched on demand and appended. Reset
  // whenever the first page's content changes (a refresh after a decision, or a
  // reconnect revalidation) because the offsets would no longer line up.
  const [extra, setExtra] = useState<{ tasks: WorkflowTask[]; rawCount: number; hasMore: boolean } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  // rawCount is in the key too: a first page that holds no procurement task still
  // changes (and shifts every later offset) when other modules' tasks come and go.
  const firstPageKey = `${result.rawCount}:${result.tasks.map((t) => t.id).join(",")}`;
  useEffect(() => {
    setExtra(null);
    setLoadMoreFailed(false);
  }, [firstPageKey]);

  const tasks = useMemo(() => {
    if (!extra) return result.tasks;
    const seen = new Set(result.tasks.map((t) => t.id));
    return [...result.tasks, ...extra.tasks.filter((t) => !seen.has(t.id))];
  }, [result.tasks, extra]);
  const maybeIncomplete = extra ? extra.hasMore : result.maybeIncomplete;
  const loadedCount = result.rawCount + (extra?.rawCount ?? 0);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    setLoadMoreFailed(false);
    try {
      const res = await fetch(`/api/proxy${TASKS_PATH}&offset=${loadedCount}`, {
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("load more failed");
      const next = toTasks(await res.json());
      setExtra((prev) => ({
        tasks: [...(prev?.tasks ?? []), ...next.tasks],
        rawCount: (prev?.rawCount ?? 0) + next.rawCount,
        // An empty page ends the walk even if the server still claims more, so a
        // misbehaving service cannot trap the button in an endless no-op loop.
        hasMore: next.maybeIncomplete && next.rawCount > 0,
      }));
    } catch {
      setLoadMoreFailed(true);
    } finally {
      setLoadingMore(false);
    }
  }, [loadedCount]);

  // Value / requester / parent PO for the visible tasks, in batches of 50. A
  // failed lookup is reported (the columns show "-" and a note), never shown as
  // a value of zero.
  const [summaries, setSummaries] = useState<Map<string, RefSummary>>(new Map());
  const [summaryState, setSummaryState] = useState<SummaryState>("idle");
  const refKey = useMemo(
    () => tasks.filter((t) => t.refId && t.refType && SUMMARY_REF_TYPES.has(t.refType)).map((t) => `${t.refType}:${t.refId}`).sort().join(","),
    [tasks],
  );
  useEffect(() => {
    if (!refKey) { setSummaries(new Map()); setSummaryState("idle"); return; }
    const refs = refKey.split(",").map((k) => { const i = k.indexOf(":"); return { refType: k.slice(0, i), refId: k.slice(i + 1) }; });
    const controller = new AbortController();
    setSummaryState("loading");
    (async () => {
      const out = new Map<string, RefSummary>();
      for (let i = 0; i < refs.length; i += SUMMARY_BATCH) {
        const res = await fetch("/api/proxy/v1/procurement/approvals/ref-summaries", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ refs: refs.slice(i, i + SUMMARY_BATCH) }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("ref summaries failed");
        const body = await res.json() as { data?: RefSummary[] };
        for (const r of body.data ?? []) out.set(r.refId, r);
      }
      setSummaries(out);
      setSummaryState("ready");
    })().catch((err: unknown) => {
      if (err instanceof Error && err.name === "AbortError") return;
      setSummaryState("error");
    });
    return () => controller.abort();
  }, [refKey]);

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
          // GAP-PROCUREMENT-APPROVALS-06: never surface the raw response body
          // or HTTP status to the approver. Map the SoD code to specific copy;
          // otherwise use the catalogued save-failure message. (useFormError's
          // rule: no raw server text/status reaches the user.)
          const fallback = toHumanError("save", { area: "approval" });
          let human = `${fallback.what} ${fallback.next}`;
          try {
            const parsed = JSON.parse(text) as { code?: string };
            if (parsed.code === "SOD_VIOLATION") {
              human = "You raised this request, so a different approver must decide it.";
            }
          } catch {
            /* keep the catalogued fallback above */
          }
          setDialogError(human);
          throw new Error(human);
        }
        setPending(null);
        setMessage(decision === "approve" ? "Approved via workflow." : "Rejected via workflow.");
        // Later pages were fetched at offsets that this decision just shifted:
        // drop them, the refreshed first page restarts the walk.
        setExtra(null);
        refresh();
        router.refresh();
      } catch (err) {
        // GAP-PROCUREMENT-APPROVALS-06: the !ok branch above already set a
        // human message in dialogError before throwing. For any OTHER throw
        // (a true network/exception path from fetchOrQueue), show the
        // catalogued offline copy — never the raw exception's own text.
        setDialogError((prev) => {
          if (prev) return prev;
          const net = toHumanError("offline", { area: "approval" });
          return `${net.what} ${net.next}`;
        });
        throw err instanceof Error ? err : new Error("Network error");
      } finally {
        setBusyId(null);
      }
    },
    [refresh, router],
  );

  /** Signed value of the document: an amendment shows its CHANGE (+/-), not a total. */
  function taskValue(task: WorkflowTask): string | null {
    const sum = task.refId ? summaries.get(task.refId) : undefined;
    if (!sum) return null;
    const minor = BigInt(sum.amountMinor);
    if (task.refType === "procurement_po_amendment") {
      return `${minor > 0n ? "+" : minor < 0n ? "-" : ""}${formatMoney(minor < 0n ? -minor : minor)}`;
    }
    return formatMoney(minor);
  }

  function refLink(task: WorkflowTask): string | null {
    if (task.refType === "procurement_indent" && task.refId) return `/procurement/indents/${task.refId}`;
    if (task.refType === "procurement_po" && task.refId) return `/procurement/orders/${task.refId}`;
    if (task.refType === "procurement_plan" && task.refId) return `/procurement/planning/${task.refId}`;
    // procurement_po_amendment: refId is the amendment's own id and there is no
    // per-amendment route, so link to the PARENT PO - but only when
    // procurement-service told us which PO it is (GAP-PROCUREMENT-APPROVALS-05).
    // Without it the row stays plain text rather than linking somewhere wrong.
    if (task.refType === "procurement_po_amendment" && task.refId) {
      const poId = summaries.get(task.refId)?.poId;
      return poId ? `/procurement/orders/${poId}` : null;
    }
    return null;
  }

  const cacheNote =
    offline || source === "cache"
      ? `Saved queue${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — offline" : ""}.`
      : null;

  const dialogTask = pending?.task;
  const isReject = pending?.decision === "reject";
  // GAP-PROCUREMENT-APPROVALS-07: the approver sees the value they are deciding on, in the dialog.
  const dialogValue = dialogTask ? taskValue(dialogTask) : null;

  // Build table rows as plain records for DataTable
  type TaskRow = {
    id: string;
    name: string;
    refId: string;
    roleRef: string;
    value: string;
    requestedBy: string;
    _task: WorkflowTask;
  };

  const tableRows: TaskRow[] = tasks.map((task) => ({
    id: task.id,
    name: task.name,
    // Human reference (indent no / PO no / "PO / Amendment n") when known; the
    // bare id only as a last resort.
    refId: (task.refId ? summaries.get(task.refId)?.label : undefined) ?? task.refId ?? "—",
    roleRef: task.roleRef ?? "any",
    value: taskValue(task) ?? "—",
    requestedBy: (task.refId ? summaries.get(task.refId)?.requestedBy : undefined) ?? "—",
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
          <Link href={href} className="mono" style={{ color: "var(--indigo)" }}>{row.refId}</Link>
        ) : (
          <span className="mono">{row.refId}</span>
        );
      },
    },
    { key: "value", label: tw("value") },
    { key: "requestedBy", label: tw("requestedBy") },
    { key: "roleRef", label: "Role" },
    {
      key: "id",
      label: "Actions",
      render: (row) => !canActOnTask(row._task, viewerRoles) ? (
        <span style={{ color: "var(--mut)", fontSize: "0.8125rem" }}>Assigned to {row._task.roleRef}</span>
      ) : (
        <>
          <Button
            type="button"
            variant="primary"
            size="sm"
            style={{ marginRight: 6, minHeight: 36 }}
            disabled={busyId === row.id}
            onClick={() => { setMessage(""); setDialogError(undefined); setPending({ task: row._task, decision: "approve" }); }}
          >
            Approve
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            style={{ minHeight: 36 }}
            disabled={busyId === row.id}
            onClick={() => { setMessage(""); setDialogError(undefined); setPending({ task: row._task, decision: "reject" }); }}
          >
            Reject
          </Button>
        </>
      ),
    },
  ];

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div className="card-h">
        <h3>Workflow approval queue</h3>
        {cacheNote ? <span style={{ fontSize: 12, color: "var(--warn)" }}>{cacheNote}</span> : null}
      </div>
      {message ? (
        <p className="pad" role="status" aria-live="polite" style={{ color: "var(--good)", fontSize: "0.875rem", paddingBottom: 0 }}>{message}</p>
      ) : null}

      {loading && tasks.length === 0 ? (
        <p className="pad" style={{ textAlign: "center", color: "var(--mut)" }}>Loading workflow tasks…</p>
      ) : error && tasks.length === 0 ? (
        <ErrorState error={toHumanError("load", { area: "workflow approval queue" })} onRetry={refresh} />
      ) : tasks.length === 0 && !maybeIncomplete ? (
        <EmptyState icon="✅" title="No pending tasks" message="No pending procurement workflow tasks at this time." />
      ) : (
        <>
          {/* A "No pending tasks" all-clear is only shown once the server has said
              there are no further pages. While pages remain -- even if none of the
              rows loaded so far is a procurement task -- say so and offer the next
              page, so a truncated list is never mistaken for an empty queue. */}
          {maybeIncomplete ? (
            <div className="pad" style={{ paddingBottom: 0 }}>
              <p role="status" style={{ color: "var(--warn)", fontSize: "0.8125rem", margin: "0 0 8px" }}>
                {tasks.length === 0
                  ? tw("noneLoadedMoreExist", { count: loadedCount })
                  : tw("moreMayExist", { count: loadedCount })}
              </p>
              {loadMoreFailed ? (
                <p role="alert" style={{ color: "var(--bad)", fontSize: "0.8125rem", margin: "0 0 8px" }}>
                  {tw("loadMoreFailed")}
                </p>
              ) : null}
              <Button type="button" variant="ghost" size="sm" disabled={loadingMore} onClick={() => { void loadMore(); }}>
                {loadingMore ? tw("loadingMore") : tw("loadMore")}
              </Button>
            </div>
          ) : null}
          {summaryState === "error" ? (
            <p className="pad" role="alert" style={{ color: "var(--bad)", fontSize: "0.8125rem", paddingBottom: 0 }}>
              {tw("summaryFailed")}
            </p>
          ) : null}
          {tasks.length > 0 ? (
            <DataTable<TaskRow>
              columns={columns}
              rows={tableRows}
              pageSize={25}
            />
          ) : null}
        </>
      )}

      <ConfirmDialog
        open={pending !== null}
        title={isReject ? "Reject this approval?" : "Approve this approval?"}
        description={
          dialogTask
            ? isReject
              ? <>Rejecting <strong>{dialogTask.name}</strong> ({dialogTask.refId ?? "—"}) returns it to the originator. A reason is mandatory and recorded in the audit trail.{dialogValue ? <> {tw("dialogValue", { value: dialogValue })}</> : null}</>
              : <>This approves <strong>{dialogTask.name}</strong> ({dialogTask.refId ?? "—"}) and advances the workflow. This action cannot be undone.{dialogValue ? <> {tw("dialogValue", { value: dialogValue })}</> : null}</>
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
