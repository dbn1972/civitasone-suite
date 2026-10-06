"use client";

/**
 * Client wrapper around the shared DataTable for workflow instances. Adds
 * StatusPill rendering + a deep-linkable status filter (URL ?status=) on top of
 * DataTable's built-in text filter / sort / pagination.
 *
 * GAP-WORKFLOW-LIST-03 — show the subject (what), definition, current step
 * (where) and start date (how old) for each instance, not just name/status.
 * GAP-WORKFLOW-LIST-04 — the ID column is a copyable short reference with the
 * full UUID in the title, not a bare ellipsised fragment.
 */
import { useMemo, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { DataTable, StatusPill } from "@/app/_components/ds";
import type { WorkflowInstance } from "../_data/workflowTypes";
import { titleCase } from "../_data/workflowTypes";
import { formatIndianDate } from "@/lib/formatters";
import { StatusFilter } from "./StatusFilter";

type Row = WorkflowInstance & Record<string, unknown>;

/** GAP-WORKFLOW-LIST-04 — copy the full id; shows a short, mono reference. */
function CopyableId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn ghost sm"
      title={id}
      aria-label={`Copy full id ${id}`}
      style={{ fontSize: 12, fontFamily: "var(--mono, monospace)" }}
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard?.writeText(id).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          () => { /* clipboard unavailable — the full id is still in the title */ },
        );
      }}
    >
      {copied ? "Copied" : `${id.slice(0, 8)}…`}
    </button>
  );
}

/** Human subject label from refType + a short refId, or the definition name. */
function subjectLabel(r: WorkflowInstance): string {
  if (r.refType) {
    const subject = titleCase(r.refType);
    return r.refId ? `${subject} · ${r.refId.slice(0, 8)}…` : subject;
  }
  return r.definitionName ? titleCase(r.definitionName) : "—";
}

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
          {
            key: "definitionName",
            label: "Definition",
            render: (r) => (r.definitionName ? titleCase(r.definitionName) : "—"),
          },
          {
            key: "refType",
            label: "Subject",
            render: (r) => subjectLabel(r),
          },
          {
            key: "currentNode",
            label: "Current step",
            render: (r) => (r.currentNode ? titleCase(r.currentNode) : "—"),
          },
          { key: "status", label: "Status", render: (r) => <StatusPill status={r.status} /> },
          {
            key: "createdAt",
            label: "Started",
            render: (r) => (r.createdAt ? formatIndianDate(r.createdAt) : "—"),
          },
          {
            key: "id",
            label: "ID",
            sortable: false,
            render: (r) => <CopyableId id={r.id} />,
          },
        ]}
      />
    </>
  );
}
