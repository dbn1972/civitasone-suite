"use client";

import Link from "next/link";
import { Card, DataTable } from "../../../_components/ds";
import type { CdpSegmentRow } from "../_data";

/**
 * GAP-CDP-SEGMENTS-02,03: a sortable/filterable segments list on the design-
 * system DataTable showing business columns — Name, Members, Rule summary,
 * Status, Updated — instead of the generic ModuleListTable's truncated-id +
 * "Detail/Meta" layout. A missing member count renders "—" (never a fabricated
 * 0). A server-driven pager plus "Showing X–Y of N" make a capped page obvious.
 */
export function SegmentsTable({
  rows,
  total,
  limit,
  offset,
}: {
  rows: CdpSegmentRow[];
  total: number;
  limit: number;
  offset: number;
}) {
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + rows.length, total);
  const hasPrev = offset > 0;
  const hasNext = offset + rows.length < total;

  return (
    <Card title="Audience segments">
      <DataTable<CdpSegmentRow>
        columns={[
          { key: "name", label: "Name" },
          { key: "members", label: "Members", align: "right" },
          { key: "ruleSummary", label: "Rule summary" },
          { key: "status", label: "Status", cellType: "status" },
          { key: "updatedAt", label: "Updated" },
        ]}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Filter segments"
        pageSize={limit}
        emptyIcon="🎯"
        emptyTitle="No segments yet"
        emptyMessage="Audience segments appear here once they are created in cdp-service."
      />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 12 }}>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {total === 0 ? "No records" : `Showing ${from}–${to} of ${total.toLocaleString("en-IN")}`}
        </span>
        <span style={{ display: "flex", gap: 8 }}>
          <Pager offset={Math.max(offset - limit, 0)} disabled={!hasPrev} label="← Prev" />
          <Pager offset={offset + limit} disabled={!hasNext} label="Next →" />
        </span>
      </div>
    </Card>
  );
}

function Pager({ offset, disabled, label }: { offset: number; disabled: boolean; label: string }) {
  if (disabled) {
    return (
      <span className="btn ghost sm" aria-disabled="true" style={{ opacity: 0.5, pointerEvents: "none" }}>
        {label}
      </span>
    );
  }
  return (
    <Link className="btn ghost sm" href={offset > 0 ? `/cdp/segments?offset=${offset}` : "/cdp/segments"}>
      {label}
    </Link>
  );
}
