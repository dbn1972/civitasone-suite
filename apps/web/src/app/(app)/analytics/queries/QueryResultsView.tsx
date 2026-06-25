"use client";

import { useMemo, useState, type ReactNode } from "react";
import { DataTable, StatusPill, EmptyState } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { useSeededResource } from "@/lib/sync/resource";
import type { AnalyticsQueryRunRow, AnalyticsResultRow } from "../_data";
import { AccessibleBarChart, type BarDatum } from "./AccessibleBarChart";

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
];

function barsFor(run: AnalyticsQueryRunRow): BarDatum[] {
  return run.rows.map((row: AnalyticsResultRow) => {
    const label =
      run.dimensions.length > 0
        ? run.dimensions.map((d) => String(row[d] ?? "—")).join(" / ")
        : "Total";
    const value = typeof row.value === "number" ? row.value : Number(row.value ?? 0);
    return { label, value };
  });
}

export function QueryResultsView({
  runs,
  source = "api",
}: {
  runs: AnalyticsQueryRunRow[];
  source?: "api" | "error";
}) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<AnalyticsQueryRunRow[]>(
    "analytics.queries",
    runs,
    source,
    (d) => d.length === 0,
  );

  const completed = useMemo(() => rows.filter((r) => r.status === "completed"), [rows]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(
    () => completed.find((r) => r.id === selectedId) ?? completed[0] ?? null,
    [completed, selectedId],
  );

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${formatIndianDate(new Date(cachedAt).toISOString())}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  const resultColumns = useMemo(() => {
    if (!selected) return [];
    const dimCols = selected.dimensions.map((d) => ({ key: d, label: d }));
    return [...dimCols, { key: "value", label: "Value", align: "right" as const }];
  }, [selected]);

  return (
    <>
      <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px", minHeight: 16 }}>
        {cacheNote ?? ""}
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
              <AccessibleBarChart title={`${selected.queryName} (${selected.metric})`} data={barsFor(selected)} />
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
