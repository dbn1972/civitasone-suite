"use client";

import { useState } from "react";
import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";

// Bug fix (works-deep-verify, MEDIUM/L3): dropped the "Agreement" column.
// work_closures has no agreement/contract reference, and neither does the
// listClosures query (execution/repo.ts) — the only place an agreement
// number exists in this service is awards.agreementNumber (tender/schema.ts),
// which listClosures never joins. mapClosureRow (_data/loaders.ts) was
// reading a field the API response never contains, so this column rendered
// "—", sortable and all, on every single row, permanently. Bringing the
// real value in would mean joining `awards` by workId — a work can have
// more than one award (re-tender/revision), so picking the "right" one
// needs a product decision (latest? finalized-only?) rather than a code fix;
// removing the dead column is the honest move until that's decided.
const columns = [
  { key: "workNumber", label: "Work Number", sortable: true },
  { key: "description", label: "Description", sortable: true },
  { key: "statusDate", label: "Status Date", sortable: true },
  { key: "remarks", label: "Remarks", sortable: true },
];

type Tab = "closed" | "dropped" | "completion";

export function ClosureTable({ closures, source }: { closures: Record<string, unknown>[]; source: "api" | "error" }) {
  const [tab, setTab] = useState<Tab>("closed");
  const { data, provenance, offline, cachedAt } = useSeededResource("works-closure", closures, source, (rows) => rows.length === 0);
  const rows = data.filter((c) => String(c.status ?? "").toLowerCase() === tab);

  return (
    <div>
      <div className="flex gap-2 mb-4" role="tablist" aria-label="Closure type">
        <button
          role="tab"
          aria-selected={tab === "closed"}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === "closed" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
          onClick={() => setTab("closed")}
        >
          Closed
        </button>
        <button
          role="tab"
          aria-selected={tab === "dropped"}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === "dropped" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
          onClick={() => setTab("dropped")}
        >
          Dropped
        </button>
        <button
          role="tab"
          aria-selected={tab === "completion"}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === "completion" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
          onClick={() => setTab("completion")}
        >
          Completion List
        </button>
      </div>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call
          `rows` is filtered from, so it can never disagree with what the
          table shows (UX-002's pattern; the page used to render a second,
          independent badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable
        columns={columns}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Search works..."
        pageSize={15}
        exportable
        exportFilename={`works-closure-${tab}`}
        emptyIcon="🔒"
        emptyTitle="No records found"
        emptyMessage={`No ${tab} works to display.`}
      />
    </div>
  );
}
