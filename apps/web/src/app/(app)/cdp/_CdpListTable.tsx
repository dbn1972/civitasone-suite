"use client";

import Link from "next/link";
import { Card, DataTable } from "../../_components/ds";
import type { ModuleRowSummary } from "@civitasone/types";

/**
 * GAP-CDP-EVENTS-02 / IDENTITY-01,02 / SEGMENTS-02,03: a sortable, filterable
 * list table for the CDP list routes, built on the design-system DataTable
 * instead of the generic ModuleListTable (which printed a truncated raw id in
 * an "ID" column, generic "Detail"/"Meta" headers, and had no sort/filter/
 * pagination). Column labels are per-route (business nouns, not "Detail/Meta"),
 * the raw id column is dropped, and a server-driven pager plus an honest
 * "Showing X–Y of N" line make a capped page obvious.
 *
 * The server returns ONE page (`rows`, `total`, `limit`, `offset`); DataTable's
 * own sort/filter operate within that page, and Prev/Next move the server
 * window via `?offset=`.
 */
export interface CdpListColumn {
  key: "label" | "sublabel" | "status" | "meta";
  label: string;
}

export function CdpListTable({
  title,
  rows,
  total,
  limit,
  offset,
  columns,
  basePath,
  filterPlaceholder,
  rowLinkPrefix,
}: {
  title: string;
  rows: ModuleRowSummary[];
  total: number;
  limit: number;
  offset: number;
  columns: CdpListColumn[];
  basePath: string;
  filterPlaceholder: string;
  rowLinkPrefix?: string;
}) {
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + rows.length, total);
  const hasPrev = offset > 0;
  const hasNext = offset + rows.length < total;

  return (
    <Card title={title}>
      <DataTable<ModuleRowSummary & Record<string, unknown>>
        columns={columns.map((c) => ({ key: c.key, label: c.label }))}
        rows={rows as (ModuleRowSummary & Record<string, unknown>)[]}
        {...(rowLinkPrefix ? { rowLinkKey: "id" as const, rowLinkPrefix } : {})}
        sortable
        filterable
        filterPlaceholder={filterPlaceholder}
        pageSize={limit}
        emptyIcon="📋"
        emptyTitle="Nothing to show"
        emptyMessage="There is nothing to display here yet."
      />
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 12 }}
      >
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {total === 0 ? "No records" : `Showing ${from}–${to} of ${total.toLocaleString("en-IN")}`}
        </span>
        <span style={{ display: "flex", gap: 8 }}>
          <PagerLink basePath={basePath} offset={Math.max(offset - limit, 0)} disabled={!hasPrev} label="← Prev" ariaLabel="Previous page" />
          <PagerLink basePath={basePath} offset={offset + limit} disabled={!hasNext} label="Next →" ariaLabel="Next page" />
        </span>
      </div>
    </Card>
  );
}

function PagerLink({
  basePath,
  offset,
  disabled,
  label,
  ariaLabel,
}: {
  basePath: string;
  offset: number;
  disabled: boolean;
  label: string;
  ariaLabel: string;
}) {
  if (disabled) {
    return (
      <span className="btn ghost sm" aria-label={ariaLabel} aria-disabled="true" style={{ opacity: 0.5, pointerEvents: "none" }}>
        {label}
      </span>
    );
  }
  const href = offset > 0 ? `${basePath}?offset=${offset}` : basePath;
  return (
    <Link className="btn ghost sm" aria-label={ariaLabel} href={href}>
      {label}
    </Link>
  );
}
