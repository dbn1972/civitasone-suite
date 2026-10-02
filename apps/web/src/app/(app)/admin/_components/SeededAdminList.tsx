"use client";
import type { ReactNode } from "react";
import { Card, EmptyState, RefreshErrorState, StatGrid } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { toHumanError } from "@/lib/messages";

/**
 * Shared body for the platform-admin list pages (entitlements, gateways, ...).
 *
 * GAP-ADMIN-ENTITLEMENTS-02/03, GAP-ADMIN-GATEWAYS-02/03: the stat cards and the
 * table used to read two different sources (server prop vs. the offline cache),
 * and a failed load rendered real zeros plus a "none configured" empty state.
 * Here ONE useSeededResource call feeds the stats, the badge and the table, and
 * a failure with nothing cached renders a retryable error (never zeros).
 *
 *  - `stats(rows)` receives `null` when the load failed with no cached copy, so
 *    every card shows an em dash rather than a fabricated 0.
 *  - A legitimately empty successful response is NOT an error: it renders the
 *    table's own empty state and genuine zeros.
 */
export function SeededAdminList<R>({
  cacheKey,
  initialRows,
  source,
  area,
  unavailable = false,
  cardTitle,
  stats,
  children,
}: {
  cacheKey: string;
  initialRows: R[];
  source: "api" | "error";
  /** Plain noun for the error copy, e.g. "entitlements". */
  area: string;
  /** The backing route does not exist (404/501): retrying cannot help, so say "not available yet". */
  unavailable?: boolean;
  cardTitle: string;
  /** Optional summary cards; omit for a plain list. */
  stats?: (rows: R[] | null) => ReactNode;
  children: (rows: R[]) => ReactNode;
}) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<R[]>(
    cacheKey,
    initialRows,
    source,
    (d) => d.length === 0,
  );
  const failed = provenance === "error-no-data";
  return (
    <>
      {stats && <StatGrid>{stats(failed ? null : rows)}</StatGrid>}
      <Card title={cardTitle}>
        {failed && unavailable ? (
          <EmptyState icon="🚧" title="Not available yet" message={`The ${area} service is not available on this platform yet. Nothing is wrong with your account; there is nothing to retry.`} />
        ) : failed ? (
          <RefreshErrorState error={toHumanError("load", { area })} backHref="/admin" />
        ) : (
          <>
            <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
            {children(rows)}
          </>
        )}
      </Card>
    </>
  );
}
