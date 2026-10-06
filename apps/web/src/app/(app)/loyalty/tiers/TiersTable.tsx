"use client";

import { DataTable, EmptyState } from "../../../_components/ds";
import { RefreshErrorState } from "../../../_components/ds/RefreshErrorState";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { formatPoints } from "@/lib/formatters";
import type { LoyaltyTierRow } from "../_data";

/**
 * GAP-LOYALTY-TIERS-01: tier DEFINITIONS (name, points threshold, benefits)
 * from GET /v1/loyalty/tiers — the page previously re-queried programmes and
 * showed programme rows, never a tier. GAP-LOYALTY-TIERS-03: no 8-char UUID
 * fragment column (tier name is the first column); threshold formatted with
 * en-IN grouping.
 */

type TierTableRow = {
  id: string;
  name: string;
  level: string;
  threshold: string;
  benefits: string;
  programme: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Summarise a benefits JSON object into a short, readable string. */
function summariseBenefits(benefits: Record<string, unknown> | null): string {
  if (!benefits) return "—";
  const keys = Object.keys(benefits);
  if (keys.length === 0) return "—";
  return keys
    .map((k) => {
      const v = benefits[k];
      if (typeof v === "boolean") return v ? k : "";
      if (v === null || v === undefined) return k;
      return `${k}: ${String(v)}`;
    })
    .filter(Boolean)
    .join(", ") || "—";
}

export function TiersTable({ rows, source }: { rows: LoyaltyTierRow[]; source: "api" | "error" }) {
  const { data, provenance, offline, cachedAt } = useSeededResource<LoyaltyTierRow[]>(
    "loyalty.tiers",
    rows,
    source,
    (d) => d.length === 0,
  );

  if ((provenance ?? "live") === "error-no-data") {
    return (
      <div className="card">
        <RefreshErrorState
          error={{
            what: "We couldn't load tier definitions.",
            next: "Check your connection and try again.",
            actions: ["retry", "help"],
          }}
          backHref="/loyalty"
        />
      </div>
    );
  }

  const tableRows: TierTableRow[] = data.map((tdef) => ({
    id: tdef.id,
    name: tdef.name,
    level: tdef.level === null ? "—" : String(tdef.level),
    threshold: formatPoints(tdef.minPointsThreshold),
    benefits: summariseBenefits(tdef.benefits),
    programme: tdef.programId && UUID_RE.test(tdef.programId) ? tdef.programId.slice(0, 8) : tdef.programId ?? "—",
  }));

  return (
    <div className="card">
      <div className="card-h">
        <h3>Tiers</h3>
      </div>
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      {tableRows.length === 0 ? (
        <EmptyState
          icon="🏅"
          title="No tiers defined"
          message="Tiers are configured per programme; none have been defined yet."
        />
      ) : (
        <DataTable<TierTableRow>
          columns={[
            { key: "name", label: "Tier" },
            { key: "level", label: "Level", align: "right" },
            { key: "threshold", label: "Min points", align: "right" },
            { key: "benefits", label: "Benefits" },
            { key: "programme", label: "Programme" },
          ]}
          rows={tableRows}
          sortable
          filterable
          filterPlaceholder="Filter tiers…"
          pageSize={25}
        />
      )}
    </div>
  );
}
