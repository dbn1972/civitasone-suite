"use client";

import type { ReactNode } from "react";
import { Card, EmptyState, DataTable } from "./ds";
import { StatusPill } from "./ds/StatusPill";
import { DataSourceBadge } from "./DataSourceBadge";
import { RefreshErrorState } from "./ds/RefreshErrorState";
import type { ModuleRowSummary } from "@civitasone/types";
import { useSeededResource } from "@/lib/sync/resource";
import { toHumanError } from "@/lib/messages";
import { formatIndianDate } from "@/lib/formatters";

// GAP-ADMIN-GATEWAY-ROUTES-02: only UUID-shaped ids are shortened; slug ids
// ("hrms-leave-requests") used to collapse to a shared 8-char prefix.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GAP-INSTALL-STEPS-03: the bare <table className="tbl"> had no search, sort,
// pagination or mobile card transform, and status was plain text. The shared
// DataTable gives every ModuleListPage consumer all four plus StatusPill, with
// no per-consumer change. Columns are built once; `render` is client-safe here
// because this is a "use client" component.
//
// DataTable's generic is `T extends Record<string, unknown>`; ModuleRowSummary
// is an interface (no implicit index signature), so an intersection alias is
// used purely to satisfy that constraint — the shape is unchanged.
type ModuleRow = ModuleRowSummary & Record<string, unknown>;
type ModuleCol = {
  key: keyof ModuleRowSummary & string;
  label: string;
  align?: "left" | "right" | "center";
  render?: (row: ModuleRowSummary) => ReactNode;
  sortable?: boolean;
};

const MODULE_COLUMNS: ModuleCol[] = [
  {
    key: "id",
    label: "ID",
    // Slug/code ids are shown in full; only a bare UUID is shortened, with the
    // full id kept in a title for copy/disambiguation (GAP-ADMIN-GATEWAY-ROUTES-02).
    render: (row) => (
      <span className="mono" title={row.id}>
        {UUID_RE.test(row.id) ? row.id.slice(0, 8) : row.id}
      </span>
    ),
  },
  {
    key: "label",
    label: "Name",
    // GAP-CATALOGUE-CATEGORIES-01: a flattened hierarchy row carries an optional
    // 0-based `depth`; indent the Name cell by it so a sub-category reads as
    // nested under its parent. Rows without `depth` render flush as before.
    // DataTable owns the <td>, so the indent lives on a wrapper span.
    render: (row) => (
      <span style={row.depth ? { display: "inline-block", paddingLeft: `${row.depth * 16}px` } : undefined}>
        {row.depth ? <span aria-hidden="true" style={{ opacity: 0.5 }}>└ </span> : null}
        {row.label}
        {row.parentLabel ? <span className="muted" style={{ fontSize: "0.85em" }}> · in {row.parentLabel}</span> : null}
      </span>
    ),
  },
  { key: "sublabel", label: "Detail", render: (row) => row.sublabel ?? "—" },
  {
    key: "status",
    label: "Status",
    render: (row) => (row.status ? <StatusPill status={row.status} /> : "—"),
  },
  {
    key: "meta",
    label: "Meta",
    // GAP-FIELD-{AGENTS,ROUTES,SYNC,TASKS}-0x: a date-typed meta is formatted
    // with formatIndianDate so a raw ISO timestamp never reaches the screen.
    render: (row) => (row.meta ? (row.metaKind === "date" ? formatIndianDate(row.meta) : row.meta) : "—"),
  },
];

/** Offline-capable table body for ModuleListPage. Cache key is derived from the
 * page title so each module list keeps its own encrypted cached copy. */
export function ModuleListTable({
  cacheKey,
  rows,
  source,
  errorArea,
  backHref,
}: {
  cacheKey: string;
  rows: ModuleRowSummary[];
  source: "api" | "error";
  /**
   * GAP-IDENTITY-{API-KEYS,BREAKGLASS,SESSIONS,USERS,WEBAUTHN}-05: human noun
   * for the error state ("records" by default), e.g. "sessions". Optional so
   * every existing ModuleListPage consumer keeps working unchanged.
   */
  errorArea?: string;
  /** Optional "back" target for the error state's back action. */
  backHref?: string;
}) {
  const { data, provenance, offline, cachedAt } = useSeededResource<ModuleRowSummary[]>(
    cacheKey,
    rows,
    source,
    (d) => d.length === 0,
  );

  // GAP-IDENTITY-*-05 (shared fix for every ModuleListPage consumer): a failed
  // fetch with no usable cache used to render the amber "Couldn't load —
  // showing nothing" badge AND the "No records" EmptyState together, so a
  // genuine empty result and a hard failure looked almost identical and there
  // was no way to retry. When nothing loaded and nothing is cached, show a
  // real error state with a working Retry (router.refresh) instead — the
  // "cached" and "live" provenance paths are unchanged, so EmptyState still
  // means "the fetch succeeded and there is genuinely nothing here".
  if ((provenance ?? "live") === "error-no-data") {
    return (
      <Card title="Records">
        <RefreshErrorState
          error={toHumanError("load", { area: errorArea ?? "records" })}
          source={{ area: errorArea ?? "records" }}
          {...(backHref ? { backHref } : {})}
        />
      </Card>
    );
  }

  return (
    <Card title="Records">
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `data`, so it can never disagree with what the table shows
          (UX-002's pattern; ModuleListPage used to render a second,
          independent badge from the raw `source` prop — removed). The
          "error-no-data" case is handled above with RefreshErrorState, so by
          here provenance is only ever "live" or "cached". */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      {data.length === 0 ? (
        <EmptyState icon="📋" title="No records" message="Nothing to show yet for this module." />
      ) : (
        <DataTable<ModuleRow>
          columns={MODULE_COLUMNS}
          rows={data as ModuleRow[]}
          sortable
          filterable
          filterPlaceholder="Filter records…"
          pageSize={15}
        />
      )}
    </Card>
  );
}
