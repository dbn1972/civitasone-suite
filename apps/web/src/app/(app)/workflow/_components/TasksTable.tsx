"use client";

/**
 * Client task-inbox table. Renders StatusPill + per-row maker-checker actions
 * (claim/approve/return/reject) and a deep-linkable status filter (URL ?status=).
 */
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { DataTable, StatusPill, UserRef } from "@/app/_components/ds";
import type { WorkflowTask } from "../_data/workflowTypes";
import { titleCase } from "../_data/workflowTypes";
import { formatIndianDate } from "@/lib/formatters";
import { StatusFilter } from "./StatusFilter";
import { TaskActions } from "./TaskActions";
import { DocVerificationChecklist, type DocChecklistState } from "./DocVerificationChecklist";

type Row = WorkflowTask & Record<string, unknown>;

/**
 * GAP-WORKFLOW-MY-TASKS-02 - a human subject: the record type plus the parent
 * instance name (what is being approved). Never an id fragment.
 */
function subjectLabel(r: WorkflowTask): string {
  const type = r.refType ? titleCase(r.refType) : null;
  const name = r.instanceName?.trim() || null;
  if (type && name) return `${type} · ${name}`;
  return name ?? type ?? "—";
}

/** GAP-WORKFLOW-MY-TASKS-05 — overdue when a due date exists and is in the past. */
function isOverdue(dueAt: string | null | undefined): boolean {
  if (!dueAt) return false;
  const t = Date.parse(dueAt);
  return Number.isFinite(t) && t < Date.now();
}

/** Sort key: most-overdue / oldest first. Tasks with a dueAt rank by it; the
 *  rest by createdAt. Smaller sorts first. */
function urgencyKey(r: WorkflowTask): number {
  if (r.dueAt) {
    const d = Date.parse(r.dueAt);
    if (Number.isFinite(d)) return d;
  }
  if (r.createdAt) {
    const c = Date.parse(r.createdAt);
    if (Number.isFinite(c)) return c;
  }
  return Number.MAX_SAFE_INTEGER;
}

/** FN-26 predicate: an application-bound officer task shows a lane checklist. */
function hasDocChecklist(r: WorkflowTask): boolean {
  return Boolean(r.nodeKey && r.refId && (r.refType ?? "").toLowerCase().includes("application"));
}

/**
 * GAP-WORKFLOW-INSTANCES-DETAIL-02 — one row's actions + checklist. Owns the
 * checklist state so Approve is disabled (with a visible reason) while the
 * checklist is loading, failed to load, or has missing mandatory documents.
 * Starts in "loading" for gated rows so Approve is never briefly enabled.
 */
function TaskRowActions({ task, currentUserId }: { task: WorkflowTask; currentUserId: string | null }) {
  const t = useTranslations("workflowApproveGate");
  const gated = hasDocChecklist(task);
  const [docState, setDocState] = useState<DocChecklistState>({ status: "loading", missingMandatory: 0 });
  let blocked: string | null = null;
  if (gated) {
    if (docState.status === "loading") blocked = t("approveBlockedLoading");
    else if (docState.status === "error") blocked = t("approveBlockedError");
    else if (docState.missingMandatory > 0) blocked = t("approveBlockedMissing", { count: docState.missingMandatory });
  }
  return (
    <div style={{ display: "grid", gap: 4, justifyItems: "end" }}>
      <TaskActions
        taskId={task.id}
        status={task.status}
        assigneeId={task.assigneeId}
        currentUserId={currentUserId}
        compact
        approveBlockedReason={blocked}
      />
      {/* FN-26 — lane-scoped mandatory document checklist for officers. */}
      {gated ? (
        <DocVerificationChecklist
          laneKey={task.nodeKey}
          applicationId={task.refId}
          compact
          onState={setDocState}
        />
      ) : null}
    </div>
  );
}

interface TasksTableProps {
  tasks: WorkflowTask[];
  /** Show the instance link column (hidden on an instance detail page). */
  showInstance?: boolean;
  /** The signed-in user's id (JWT sub), for maker-checker action gating. */
  currentUserId?: string | null;
  /** Hide the status filter (e.g. a single-status pending inbox). */
  showStatusFilter?: boolean;
}

export function TasksTable({ tasks, showInstance = true, currentUserId = null, showStatusFilter = true }: TasksTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const status = params.get("status") ?? "all";

  const statuses = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) set.add(t.status);
    return ["all", ...Array.from(set).sort()];
  }, [tasks]);

  const counts = useMemo(() => {
    const m: Record<string, number> = { all: tasks.length };
    for (const t of tasks) m[t.status] = (m[t.status] ?? 0) + 1;
    return m;
  }, [tasks]);

  const filtered = useMemo(
    () => (status === "all" ? tasks : tasks.filter((t) => t.status === status)),
    [tasks, status],
  );

  function setStatus(next: string) {
    const sp = new URLSearchParams(Array.from(params.entries()));
    if (next === "all") sp.delete("status");
    else sp.set("status", next);
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  // GAP-WORKFLOW-MY-TASKS-05 — default order: most-overdue / oldest first, so
  // the inbox surfaces urgent work without the user sorting a column by hand.
  const rows: Row[] = useMemo(
    () => [...filtered].sort((a, b) => urgencyKey(a) - urgencyKey(b)) as Row[],
    [filtered],
  );

  return (
    <>
      {showStatusFilter ? (
        <StatusFilter
          label="Status"
          options={statuses.map((s) => ({
            value: s,
            label: s === "all" ? "All" : titleCase(s),
            count: counts[s] ?? 0,
          }))}
          value={status}
          onChange={setStatus}
        />
      ) : null}
      <DataTable<Row>
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Filter tasks…"
        pageSize={15}
        columns={[
          { key: "name", label: "Task" },
          { key: "nodeKey", label: "Step", render: (r) => r.nodeKey ?? "—" },
          { key: "roleRef", label: "Role", render: (r) => r.roleRef ?? "—" },
          {
            key: "refType",
            label: "Subject",
            render: (r) => subjectLabel(r),
          },
          {
            key: "requesterId",
            label: "Requested by",
            render: (r) => (r.requesterId ? <UserRef id={r.requesterId} name={r.requesterName ?? null} /> : "—"),
          },
          {
            key: "createdAt",
            label: "Age",
            render: (r) => (r.createdAt ? formatIndianDate(r.createdAt) : "—"),
          },
          {
            key: "dueAt",
            label: "Due",
            render: (r) =>
              r.dueAt ? (
                isOverdue(r.dueAt) ? (
                  <span className="pill bad np" style={{ fontSize: 11 }}>Overdue · {formatIndianDate(r.dueAt)}</span>
                ) : (
                  formatIndianDate(r.dueAt)
                )
              ) : (
                "—"
              ),
          },
          { key: "status", label: "Status", render: (r) => <StatusPill status={r.status} /> },
          {
            key: "assigneeId",
            label: "Assignee",
            render: (r) =>
              r.assigneeId ? (
                // GAP-WORKFLOW-INSTANCES-DETAIL-01 — show the server-resolved
                // assignee name (UserRef) when present, else an honest short id
                // with the full id in the title; never a guessed name.
                <UserRef id={r.assigneeId} name={r.assigneeName ?? null} />
              ) : (
                <span className="pill warn np" style={{ fontSize: 11 }}>Unassigned</span>
              ),
          },
          ...(showInstance
            ? [
                {
                  key: "instanceId" as const,
                  label: "Instance",
                  sortable: false,
                  render: (r: Row) => (
                    // GAP-WORKFLOW-MY-TASKS-02 — a labelled link ("Open instance")
                    // via next/link, not a bare uuid fragment.
                    <Link href={`/workflow/instances/${r.instanceId}`} style={{ fontSize: 12 }}>
                      Open instance
                    </Link>
                  ),
                },
              ]
            : []),
          {
            key: "id",
            label: "Actions",
            align: "right",
            sortable: false,
            render: (r) => <TaskRowActions task={r} currentUserId={currentUserId} />,
          },
        ]}
      />
    </>
  );
}
