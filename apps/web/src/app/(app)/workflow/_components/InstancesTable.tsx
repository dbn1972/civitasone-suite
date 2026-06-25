"use client";

/**
 * Client wrapper around the shared DataTable for workflow instances. Adds
 * StatusPill rendering + a deep-linkable status filter (URL ?status=) on top of
 * DataTable's built-in text filter / sort / pagination.
 */
import { useMemo } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { DataTable, StatusPill } from "@/app/_components/ds";
import type { WorkflowInstance } from "../_data/workflowTypes";
import { titleCase } from "../_data/workflowTypes";
import { StatusFilter } from "./StatusFilter";

type Row = WorkflowInstance & Record<string, unknown>;

export function InstancesTable({ instances }: { instances: WorkflowInstance[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const status = params.get("status") ?? "all";

  const statuses = useMemo(() => {
    const set = new Set<string>();
    for (const i of instances) set.add(i.status);
    return ["all", ...Array.from(set).sort()];
  }, [instances]);

  const filtered = useMemo(
    () => (status === "all" ? instances : instances.filter((i) => i.status === status)),
    [instances, status],
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
        options={statuses.map((s) => ({ value: s, label: s === "all" ? "All" : titleCase(s) }))}
        value={status}
        onChange={setStatus}
      />
      <DataTable<Row>
        rows={rows}
        rowHref={(r) => `/workflow/instances/${r.id}`}
        sortable
        filterable
        filterPlaceholder="Filter instances…"
        pageSize={15}
        columns={[
          { key: "name", label: "Instance" },
          { key: "status", label: "Status", render: (r) => <StatusPill status={r.status} /> },
          { key: "version", label: "Version", align: "right" },
          {
            key: "id",
            label: "ID",
            sortable: false,
            render: (r) => <span className="mono" style={{ fontSize: 12 }}>{r.id.slice(0, 8)}…</span>,
          },
        ]}
      />
    </>
  );
}
