"use client";

import { useMemo, useState, type ReactNode } from "react";
import { DataTable, Segmented, StatusPill } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { humanizeStatus } from "@/lib/formatters";

type LegalCase = {
  id: string;
  caseNo: string;
  title: string;
  court: string;
  type: string;
  advocateName?: string | null;
  status: string;
} & Record<string, unknown>;

/**
 * GAP-LEGAL-LIST-02: the set of case statuses that count as a live/active
 * matter. "pending", "appealed" and "stayed" are all still-open; disposed /
 * settled are terminal. Exported so the list page's "Active Cases" card and
 * any table-side logic share one definition and cannot drift.
 */
export const ACTIVE_CASE_STATUSES: readonly string[] = ["pending", "appealed", "stayed"];

/**
 * GAP-LEGAL-LIST-01: a writ or criminal matter is a CASE CATEGORY, not a
 * computed risk assessment. This single predicate backs both the list page's
 * "Writ / Criminal" stat card and the table's "Writ & criminal" filter so the
 * two counts are guaranteed to agree.
 */
export function isWritOrCriminal(c: { type: string }): boolean {
  return c.type === "writ" || c.type === "criminal";
}

/**
 * GAP-LEGAL-LIST-03: human label for a raw case-type code (the summary payload
 * carries a lowercase enum such as "writ"). Falls back to humanizeStatus for
 * anything without an explicit label.
 */
const CASE_TYPE_LABELS: Record<string, string> = {
  writ: "Writ Petition",
  civil: "Civil",
  criminal: "Criminal",
  arbitration: "Arbitration",
  tribunal: "Tribunal",
  appeal: "Appeal",
  other: "Other",
};
function caseTypeLabel(type: string): string {
  return CASE_TYPE_LABELS[type.toLowerCase()] ?? humanizeStatus(type);
}

const FILTERS = ["All", "High Court", "Writ & criminal"] as const;

function caseStatusPill(status: string): ReactNode {
  switch (status) {
    case "pending":
      return <span className="pill warn">Pending</span>;
    case "disposed":
      return <span className="pill mut">Disposed</span>;
    case "appealed":
      return <span className="pill info">Appealed</span>;
    case "stayed":
      return <span className="pill info">Stayed</span>;
    case "settled":
      return <span className="pill good">Settled</span>;
    default:
      return <StatusPill status={status} />;
  }
}

export function LegalCasesTable({ items, source = "api" }: { items: LegalCase[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<LegalCase[]>(
    "legal.cases",
    items,
    source,
    (d) => d.length === 0,
  );

  const [filter, setFilter] = useState<string>("All");

  const visible = useMemo(() => {
    if (filter === "High Court") return rows.filter((r) => r.court.toLowerCase().includes("high court"));
    if (filter === "Writ & criminal") return rows.filter(isWritOrCriminal);
    return rows;
  }, [rows, filter]);

  return (
    <div className="card">
      <div className="card-h">
        <h3>Court cases</h3>
        <Segmented options={[...FILTERS]} value={filter} onChange={setFilter} />
      </div>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<LegalCase>
        columns={[
          { key: "caseNo", label: "Case no.", render: (r) => <span className="mono">{r.caseNo}</span> },
          { key: "title", label: "Title" },
          { key: "court", label: "Court" },
          { key: "type", label: "Case type", render: (r) => <>{caseTypeLabel(r.type)}</> },
          { key: "advocateName", label: "Counsel", render: (r) => <>{r.advocateName ?? "—"}</> },
          { key: "status", label: "Status", render: (r) => caseStatusPill(r.status) },
        ]}
        rows={visible}
        rowLinkKey="id"
        rowLinkPrefix="/legal/cases/"
        sortable
        filterable
        filterPlaceholder="Filter cases…"
        pageSize={15}
      />
    </div>
  );
}
