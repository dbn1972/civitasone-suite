"use client";

import { Card, EmptyState } from "./ds";
import { StatusPill } from "./ds/StatusPill";
import { DataSourceBadge } from "./DataSourceBadge";
import { RefreshErrorState } from "./ds/RefreshErrorState";
import type { ModuleRowSummary } from "@civitasone/types";
import { useSeededResource } from "@/lib/sync/resource";
import { toHumanError } from "@/lib/messages";

// GAP-ADMIN-GATEWAY-ROUTES-02: only UUID-shaped ids are shortened; slug ids
// ("hrms-leave-requests") used to collapse to a shared 8-char prefix.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
                <td><span className="mono" title={row.id}>{UUID_RE.test(row.id) ? row.id.slice(0, 8) : row.id}</span></td>
                <td>{row.label}</td>
                <td>{row.sublabel ?? "—"}</td>
                <td>{row.status ? <StatusPill status={row.status} /> : "—"}</td>
                <td>{row.meta ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </Card>
  );
}
