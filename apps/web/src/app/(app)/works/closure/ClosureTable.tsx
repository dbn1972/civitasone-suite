"use client";

import { useMemo, useState } from "react";
import { DataTable, Tabs } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";

// Bug fix (works-deep-verify, MEDIUM/L3): dropped the "Agreement" column.
// work_closures has no agreement/contract reference, and neither does the
// listClosures query (execution/repo.ts) — the only place an agreement
// number exists in this service is awards.agreementNumber (tender/schema.ts),
// which listClosures never joins. See GAP-WORKS-CLOSURE-02 (decision pending).

// GAP-WORKS-CLOSURE-03/04: tab keys are the normalised closureType values
// mapClosureRow emits (loaders.ts normalizeClosureType). "All" shows every
// row; "Other" only appears when an unknown value exists so a stray value is
// never silently dropped from the register. Each tab carries a per-type date
// column label (CLOSURE-04) so "Status Date" no longer hides what date it is.
const TAB_META: Record<string, { label: string; dateLabel: string; empty: string }> = {
  all: { label: "All", dateLabel: "Date", empty: "No works in the closure register." },
  closed: { label: "Closed", dateLabel: "Closed on", empty: "No works in the closed list." },
  dropped: { label: "Dropped", dateLabel: "Dropped on", empty: "No works in the dropped list." },
  completion: { label: "Completion", dateLabel: "Completed on", empty: "No works in the completion list." },
  other: { label: "Other", dateLabel: "Date", empty: "No works with an unrecognised closure type." },
};

export function ClosureTable({ closures, source }: { closures: Record<string, unknown>[]; source: "api" | "error" }) {
  const { data, provenance, offline, cachedAt } = useSeededResource("works-closure", closures, source, (rows) => rows.length === 0);

  const hasOther = useMemo(() => data.some((c) => String(c.status ?? "") === "other"), [data]);
  // Order: All first (default), then the three canonical types, then Other
  // only when at least one unknown value is present.
  const tabKeys = useMemo(
    () => ["all", "closed", "dropped", "completion", ...(hasOther ? ["other"] : [])],
    [hasOther],
  );
  const [tabKey, setTabKey] = useState<string>("all");

  const labelToKey = useMemo(
    () => Object.fromEntries(tabKeys.map((k) => [TAB_META[k].label, k])),
    [tabKeys],
  );
  const meta = TAB_META[tabKey] ?? TAB_META.all;
  const rows = tabKey === "all" ? data : data.filter((c) => String(c.status ?? "") === tabKey);

  const columns = [
    { key: "workNumber", label: "Work Number", sortable: true },
    // GAP-WORKS-CLOSURE-02: agreement number, populated only when the work has
    // exactly one finalized award (else "—"); never guesses among multiple.
    { key: "agreement", label: "Agreement", sortable: true },
    { key: "description", label: "Description", sortable: true },
    { key: "statusDate", label: meta.dateLabel, sortable: true },
    { key: "remarks", label: "Remarks", sortable: true },
  ];

  return (
    <div>
      <Tabs
        tabs={tabKeys.map((k) => `${TAB_META[k].label} (${k === "all" ? data.length : data.filter((c) => String(c.status ?? "") === k).length})`)}
        active={`${meta.label} (${tabKey === "all" ? data.length : rows.length})`}
        onChange={(labelWithCount) => {
          const label = labelWithCount.replace(/\s*\(\d+\)\s*$/, "");
          const key = labelToKey[label];
          if (key) setTabKey(key);
        }}
        ariaLabel="Closure type"
      />
      {/* UX-012: single provenance badge, same source as the rows. */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable
        columns={columns}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Search works..."
        pageSize={15}
        exportable
        exportFilename={`works-closure-${tabKey}`}
        emptyIcon="🔒"
        emptyTitle="No records found"
        emptyMessage={meta.empty}
        // GAP-WORKS-CLOSURE-01: rows now open the work (previously a dead-end list).
        rowHref={(row) => (row.workId ? `/works/execution/${String(row.workId)}` : undefined)}
      />
    </div>
  );
}
