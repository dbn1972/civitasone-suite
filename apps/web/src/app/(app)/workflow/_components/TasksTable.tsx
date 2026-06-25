"use client";

/**
 * Client task-inbox table. Renders StatusPill + per-row maker-checker actions
 * (claim/approve/return/reject) and a deep-linkable status filter (URL ?status=).
 */
import { useMemo } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { DataTable, StatusPill } from "@/app/_components/ds";
import type { WorkflowTask } from "../_data/workflowTypes";
import { titleCase } from "../_data/workflowTypes";
import { StatusFilter } from "./StatusFilter";
import { TaskActions } from "./TaskActions";

type Row = WorkflowTask & Record<string, unknown>;

interface TasksTableProps {
  tasks: WorkflowTask[];
  /** Show the instance link column (hidden on an instance detail page). */
  showInstance?: boolean;
}

export function TasksTable({ tasks, showInstance = true }: TasksTableProps) {
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

  const rows: Row[] = filtered as Row[];

  return (
    <>
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
            render: (r) => (r.refType ? titleCase(r.refType) : "—"),
          },
          { key: "status", label: "Status", render: (r) => <StatusPill status={r.status} /> },
          {
            key: "assigneeId",
            label: "Assignee",
            render: (r) =>
              r.assigneeId ? (
                <span className="mono" style={{ fontSize: 12 }}>{r.assigneeId.slice(0, 8)}…</span>
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
                    <a href={`/workflow/instances/${r.instanceId}`} className="mono" style={{ fontSize: 12 }}>
                      {r.instanceId.slice(0, 8)}…
                    </a>
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
              <TaskActions taskId={r.id} status={r.status} assigned={Boolean(r.assigneeId)} compact />
            ),
          },
        ]}
      />
    </>
  );
}
