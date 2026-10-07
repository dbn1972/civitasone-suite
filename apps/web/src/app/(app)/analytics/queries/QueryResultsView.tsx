"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { DataTable, StatusPill, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { formatMoney } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import type { AnalyticsQueryRunRow, AnalyticsResultRow, MetricUnit } from "../_data";
import { AccessibleBarChart, type BarDatum } from "./AccessibleBarChart";

/**
 * GAP-ANALYTICS-QUERIES-04: render a metric value in its declared unit. Money
 * metrics (`paise`) go through the shared bigint-safe paise→rupee formatter so
 * a value of 12345 reads "₹123.45", never the ambiguous bare "12,345". A count
 * stays a plain Indian-grouped integer.
 */
function formatMetricValue(value: number, unit: MetricUnit): string {
  if (unit === "paise") return formatMoney(Math.round(value));
  return value.toLocaleString("en-IN");
}

type RunCol = {
  key: keyof AnalyticsQueryRunRow & string;
  label: string;
  align?: "left" | "right" | "center";
  render?: (row: AnalyticsQueryRunRow) => ReactNode;
};

const runColumns: RunCol[] = [
  { key: "queryName", label: "Query" },
  { key: "metric", label: "Metric" },
  { key: "kind", label: "Kind" },
  { key: "status", label: "Status", render: (r) => <StatusPill status={r.status} label={r.status.toUpperCase()} /> },
  { key: "resultRows", label: "Rows", align: "right" },
  // GAP-ANALYTICS-QUERIES-02: a failed run previously showed only a FAILED
  // pill — the mapped `error` (../_data.ts) was never rendered, so a user
  // could not see WHY a run failed. Show it inline for failed runs only,
  // truncated with the full text in a title tooltip. The message is the
  // registry/zod reason the service recorded (sanitised server-side; see
  // GAP-02 report note) — completed runs render nothing here.
  {
    key: "error",
    label: "Error",
    render: (r) =>
      r.status === "failed" && r.error ? (
        <span
          title={r.error}
          style={{
            display: "inline-block",
            maxWidth: 280,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            verticalAlign: "bottom",
            color: "#b91c1c",
            fontSize: 13,
          }}
        >
          {r.error}
        </span>
      ) : null,
  },
];

function barsFor(run: AnalyticsQueryRunRow): BarDatum[] {
  return run.rows.map((row: AnalyticsResultRow) => {
    const label =
      run.dimensions.length > 0
        ? run.dimensions.map((d) => String(row[d] ?? "—")).join(" / ")
        : "Total";
    const value = typeof row.value === "number" ? row.value : Number(row.value ?? 0);
    // Raw numeric value; the chart formats it per `unit` (GAP-04).
    return { label, value };
  });
}

/** True while a run is still being processed server-side (GAP-03). */
function isPending(status: string): boolean {
  return status === "running" || status === "queued" || status === "pending";
}

export function QueryResultsView({
  runs,
  source = "api",
}: {
  runs: AnalyticsQueryRunRow[];
  source?: "api" | "error";
}) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<AnalyticsQueryRunRow[]>(
    "analytics.queries",
    runs,
    source,
    (d) => d.length === 0,
  );

  const router = useRouter();

  // GAP-ANALYTICS-QUERIES-03: a queued/running run used to stay invisible
  // until a manual reload (the page is a server component and nothing
  // refreshed it). Poll router.refresh() while any run is still pending, at a
  // ≥5s interval, and stop once none remain or the component unmounts. We also
  // cap the number of polls so a run wedged in "running" can't poll forever.
  const pending = useMemo(() => rows.some((r) => isPending(r.status)), [rows]);
  const [doneAnnounce, setDoneAnnounce] = useState(false);
  const wasPending = useRef(false);
  const pollCount = useRef(0);
  const POLL_INTERVAL_MS = 5000;
  const MAX_POLLS = 60; // ~5 minutes at 5s

  useEffect(() => {
    // Announce once when a run that was pending has resolved.
    if (!pending && wasPending.current) setDoneAnnounce(true);
    wasPending.current = pending;
  }, [pending]);

  useEffect(() => {
    if (!pending) return;
    pollCount.current = 0;
    const id = setInterval(() => {
      pollCount.current += 1;
      if (pollCount.current > MAX_POLLS) {
        clearInterval(id);
        return;
      }
      router.refresh();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [pending, router]);

  const completed = useMemo(() => rows.filter((r) => r.status === "completed"), [rows]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(
    () => completed.find((r) => r.id === selectedId) ?? completed[0] ?? null,
    [completed, selectedId],
  );

  const resultColumns = useMemo(() => {
    if (!selected) return [];
    // GAP-ANALYTICS-QUERIES-04: use the metric's human label for the value
    // column header (e.g. "Total amount") instead of the fixed word "Value",
    // and format the value in the metric's unit (money → ₹). Dimension headers
    // stay the dimension keys the run carries (the catalog label isn't stored
    // per run); keys are the whitelisted, human-readable registry keys.
    const dimCols = selected.dimensions.map((d) => ({ key: d, label: d }));
    const unit = selected.metricUnit;
    return [
      ...dimCols,
      {
        key: "value",
        label: selected.metric,
        align: "right" as const,
        render: (row: AnalyticsResultRow) => {
          const n = typeof row.value === "number" ? row.value : Number(row.value ?? 0);
          return formatMetricValue(n, unit);
        },
      },
    ];
  }, [selected]);

  // GAP-ANALYTICS-QUERIES-01: when the live fetch failed AND there is no cached
  // copy to fall back on, show an honest retry affordance instead of an empty
  // table beside "—" stat cards. `provenance === "error-no-data"` is the single
  // source of truth (UX-002) — it never co-exists with a "showing saved data"
  // badge.
  if (provenance === "error-no-data") {
    return (
      <RefreshErrorState
        error={toHumanError("load", { area: "analytics query results" })}
        backHref="/analytics"
        source={{ area: "analytics query results" }}
      />
    );
  }

  return (
    <>
      {/* UX-012: this badge is the ONLY place that reports data provenance
          for the rows shown below — it reads the same useSeededResource
          call as `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />

      {/* GAP-ANALYTICS-QUERIES-03: announce to assistive tech when a queued/
          running run has finished and the table has refreshed in place. */}
      <p className="sr-only" role="status" aria-live="polite">
        {pending ? "A query run is in progress; results will update automatically." : doneAnnounce ? "Query run completed." : ""}
      </p>

      <DataTable<AnalyticsQueryRunRow>
        columns={runColumns}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Filter query runs…"
        pageSize={10}
      />

      {completed.length > 0 ? (
        <section aria-label="Selected query result" style={{ marginTop: 20 }}>
          <h3 style={{ fontSize: 15, margin: "0 0 8px" }}>Result detail</h3>

          {/* Accessible run selector: a labelled list of buttons, keyboard-navigable. */}
          <ul
            aria-label="Choose a completed run to inspect"
            style={{ display: "flex", flexWrap: "wrap", gap: 8, listStyle: "none", padding: 0, margin: "0 0 14px" }}
          >
            {completed.map((r) => {
              const isSel = selected?.id === r.id;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    aria-current={isSel ? "true" : undefined}
                    onClick={() => setSelectedId(r.id)}
                    className="btn sm"
                    style={{
                      border: isSel ? "2px solid #1d4ed8" : "1px solid #cbd5e1",
                      background: isSel ? "#eff6ff" : "#fff",
                      color: "#0f172a",
                      borderRadius: 6,
                      padding: "4px 10px",
                      cursor: "pointer",
                    }}
                  >
                    {r.queryName} — {r.metric}
                  </button>
                </li>
              );
            })}
          </ul>

          {selected ? (
            <div aria-live="polite" style={{ display: "grid", gap: 16 }}>
              <AccessibleBarChart
                title={`${selected.queryName} (${selected.metric})`}
                data={barsFor(selected)}
                formatValue={(v) => formatMetricValue(v, selected.metricUnit)}
              />
              <div>
                <h4 style={{ fontSize: 14, margin: "0 0 6px" }}>Result rows</h4>
                <DataTable<AnalyticsResultRow>
                  columns={resultColumns}
                  rows={selected.rows}
                  sortable
                  pageSize={20}
                />
              </div>
            </div>
          ) : null}
        </section>
      ) : (
        <div style={{ marginTop: 16 }}>
          <EmptyState icon="🧮" title="No completed results yet" message="Run a query to see accessible charts and result tables here." />
        </div>
      )}
    </>
  );
}
