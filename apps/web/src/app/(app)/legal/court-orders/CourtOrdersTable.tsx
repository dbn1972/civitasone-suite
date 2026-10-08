"use client";

import { useMemo, useState, type ReactNode } from "react";
import { DataTable, Segmented, StatusPill } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { formatIndianDate, humanizeStatus } from "@/lib/formatters";
import { useSeededResource } from "@/lib/sync/resource";
import type { CourtOrderSummary } from "@civitasone/types";

type Row = CourtOrderSummary & Record<string, unknown>;

const FILTERS = ["All", "Due", "Risk"] as const;

/**
 * GAP-LEGAL-COURT-ORDERS-03: a deadline that falls *today* (IST) is not yet
 * breached, so Overdue/Contempt Risk uses a strict `<` against today's IST
 * date. `isDueToday` is surfaced separately as a warning, and this single
 * helper is shared by the page tile count and the table so the two can never
 * disagree.
 */
export function isOverdue(o: CourtOrderSummary, today: string): boolean {
  return Boolean(
    o.complianceRequired && o.status === "pending" && o.complianceDeadline && o.complianceDeadline < today,
  );
}

function isDueToday(o: CourtOrderSummary, today: string): boolean {
  return Boolean(
    o.complianceRequired && o.status === "pending" && o.complianceDeadline === today,
  );
}

function orderStatusPill(o: CourtOrderSummary, today: string): ReactNode {
  if (o.status === "complied") return <span className="pill good">Complied</span>;
  if (isOverdue(o, today)) return <span className="pill bad">Overdue</span>;
  if (isDueToday(o, today)) return <span className="pill warn">Due today</span>;
  if (o.status === "pending") return <span className="pill warn">Compliance due</span>;
  if (o.status === "appealed") return <span className="pill info">Under appeal</span>;
  if (o.status === "stayed") return <span className="pill mut">Stayed</span>;
  return <StatusPill status={o.status} />;
}

export function CourtOrdersTable({
  items,
  today,
  source = "api",
  initialFilter = "All",
}: {
  items: CourtOrderSummary[];
  today: string;
  source?: "api" | "error";
  // GAP2-LEGAL-COURT-ORDERS-11: seed the segmented filter from the URL
  // (?filter=risk → "Risk") so "Contempt watch" shows the at-risk view on
  // first render instead of defaulting to "All" and ignoring the query string.
  initialFilter?: (typeof FILTERS)[number];
}) {
  const { data: rows0, provenance, offline, cachedAt } = useSeededResource<CourtOrderSummary[]>(
    "legal.court-orders",
    items,
    source,
    (d) => d.length === 0,
  );
  const [filter, setFilter] = useState<string>(initialFilter);

  const rows = useMemo<Row[]>(() => {
    const base = rows0 as Row[];
    if (filter === "Due") return base.filter((o) => o.complianceRequired && o.status === "pending");
    if (filter === "Risk") return base.filter((o) => isOverdue(o, today));
    return base;
  }, [rows0, filter, today]);

  return (
    <div className="card">
      <div className="card-h">
        <h3>Court order compliance</h3>
        <Segmented options={[...FILTERS]} value={filter} onChange={setFilter} />
      </div>
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<Row>
        columns={[
          { key: "caseNo", label: "Case", render: (r) => <span className="mono">{r.caseNo}</span> },
          { key: "summary", label: "Direction" },
          { key: "department", label: "Dept", render: (r) => <>{r.department ?? "—"}</> },
          // GAP-LEGAL-COURT-ORDERS-01: show the recorded order type (judgment,
          // interim, stay, direction, order…) rather than deriving a bogus
          // "Issued"/"Stay" from complianceRequired.
          { key: "orderType", label: "Type", render: (r) => <>{r.orderType ? humanizeStatus(r.orderType) : "—"}</> },
          { key: "complianceRequired", label: "Compliance", render: (r) => <>{r.complianceRequired ? "Required" : "No"}</> },
          { key: "complianceDeadline", label: "Due", render: (r) => <>{r.complianceDeadline ? formatIndianDate(r.complianceDeadline) : "—"}</> },
          { key: "status", label: "Status", render: (r) => orderStatusPill(r, today) },
        ]}
        rows={rows}
        rowHref={(r) => `/legal/cases/${r.caseId}`}
        sortable
        filterable
        filterPlaceholder="Filter orders…"
        pageSize={15}
      />
    </div>
  );
}
