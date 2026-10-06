"use client";

/**
 * Client task-inbox table. Renders StatusPill + per-row maker-checker actions
 * (claim/approve/return/reject) and a deep-linkable status filter (URL ?status=).
 */
import { useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { DataTable, StatusPill } from "@/app/_components/ds";
import type { WorkflowTask } from "../_data/workflowTypes";
import { titleCase } from "../_data/workflowTypes";
import { formatIndianDate } from "@/lib/formatters";
import { StatusFilter } from "./StatusFilter";
import { TaskActions } from "./TaskActions";
import { DocVerificationChecklist } from "./DocVerificationChecklist";

type Row = WorkflowTask & Record<string, unknown>;

/** GAP-WORKFLOW-MY-TASKS-02 — a human subject label (refType + short refId). */
function subjectLabel(r: WorkflowTask): string {
  if (!r.refType) return "—";
  const subject = titleCase(r.refType);
  return r.refId ? `${subject} · ${r.refId.slice(0, 8)}…` : subject;
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
                <span className="mono" style={{ fontSize: 12 }} title={`User ID: ${r.assigneeId}`} aria-label={`User ID ${r.assigneeId}`}>{r.assigneeId.slice(0, 8)}…</span>
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
            render: (r) => (
              <div style={{ display: "grid", gap: 4, justifyItems: "end" }}>
                <TaskActions taskId={r.id} status={r.status} assigneeId={r.assigneeId} currentUserId={currentUserId} compact />
                {/* FN-26 — lane-scoped mandatory document checklist for officers. */}
                {r.nodeKey && r.refId && (r.refType ?? "").toLowerCase().includes("application") ? (
                  <DocVerificationChecklist
                    laneKey={r.nodeKey}
                    applicationId={r.refId}
                    compact
                  />
                ) : null}
              </div>
            ),
          },
        ]}
      />
    </>
  );
}
