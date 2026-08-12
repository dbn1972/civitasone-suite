"use client";

import { Card, EmptyState } from "./ds";
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
  const { data, fromCache, offline, cachedAt } = useSeededResource<ModuleRowSummary[]>(
    cacheKey,
    rows,
    source,
    (d) => d.length === 0,
  );

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <Card title="Records">
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "var(--warn)", margin: "0", padding: "8px 16px 0" }}>
          {cacheNote}
        </p>
      ) : null}
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
