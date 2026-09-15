"use client";

import { Card, EmptyState } from "./ds";
import { DataSourceBadge } from "./DataSourceBadge";
import type { ModuleRowSummary } from "@civitasone/types";
import { useSeededResource } from "@/lib/sync/resource";

/** Offline-capable table body for ModuleListPage. Cache key is derived from the
 * page title so each module list keeps its own encrypted cached copy. */
export function ModuleListTable({
  cacheKey,
  rows,
  source,
}: {
  cacheKey: string;
  rows: ModuleRowSummary[];
  source: "api" | "error";
}) {
  const { data, provenance, offline, cachedAt } = useSeededResource<ModuleRowSummary[]>(
    cacheKey,
    rows,
    source,
    (d) => d.length === 0,
  );

  return (
    <Card title="Records">
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `data`, so it can never disagree with what the table shows
          (UX-002's pattern; ModuleListPage used to render a second,
          independent badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      {data.length === 0 ? (
        <EmptyState icon="📋" title="No records" message="Nothing to show yet for this module." />
      ) : (
        <div className="tbl-wrap"><table className="tbl">
          <thead>
            <tr>
              <th scope="col">ID</th>
              <th scope="col">Name</th>
              <th scope="col">Detail</th>
              <th scope="col">Status</th>
              <th scope="col">Meta</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.id}>
                <td><span className="mono">{row.id.slice(0, 8)}</span></td>
                <td>{row.label}</td>
                <td>{row.sublabel ?? "—"}</td>
                <td>{row.status ?? "—"}</td>
                <td>{row.meta ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </Card>
  );
}
