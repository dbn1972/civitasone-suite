"use client";

import { DataTable, EmptyState, StatusPill } from "../../../_components/ds";
import { RefreshErrorState } from "../../../_components/ds/RefreshErrorState";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { formatIndianDate } from "@/lib/formatters";
import type { LoyaltyProgramRow } from "../_data";

/**
 * GAP-LOYALTY-PROGRAMS-01: programme NAME is the first column — the generic
 * table led with an 8-char UUID fragment that means nothing for a UUID-keyed
 * programme. GAP-LOYALTY-PROGRAMS-02: status renders through StatusPill, not
 * raw lowercase text. (Create/edit is NOT built here — see the home-tile copy
 * change and the recorded decision; a programme editor is an L >2d item that
 * needs an approval/audit flow.)
 */

type ProgramTableRow = {
  id: string;
  name: string;
  status: string;
  earnRatio: string;
  expiry: string;
  updated: string;
};

export function ProgramsTable({ rows, source }: { rows: LoyaltyProgramRow[]; source: "api" | "error" }) {
  const { data, provenance, offline, cachedAt } = useSeededResource<LoyaltyProgramRow[]>(
    "loyalty.programs",
    rows,
    source,
    (d) => d.length === 0,
  );

  if ((provenance ?? "live") === "error-no-data") {
    return (
      <div className="card">
        <RefreshErrorState
          error={{
            what: "We couldn't load loyalty programmes.",
            next: "Check your connection and try again.",
            actions: ["retry", "help"],
          }}
          backHref="/loyalty"
        />
      </div>
    );
  }

  const tableRows: ProgramTableRow[] = data.map((p) => ({
    id: p.id,
    name: p.name,
    status: p.status,
    earnRatio: p.earnRatio ? `${p.earnRatio} per ₹` : "—",
    expiry: p.expiryDays === null ? "No expiry" : `${p.expiryDays} days`,
    updated: p.updatedAt ? formatIndianDate(p.updatedAt) : "—",
  }));

  return (
    <div className="card">
      <div className="card-h">
        <h3>Programmes</h3>
      </div>
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      {tableRows.length === 0 ? (
        <EmptyState icon="📋" title="No programmes" message="No loyalty programmes to show yet." />
      ) : (
        <DataTable<ProgramTableRow>
          columns={[
            { key: "name", label: "Programme" },
            { key: "status", label: "Status", render: (r) => <StatusPill status={r.status} /> },
            { key: "earnRatio", label: "Earn ratio", align: "right" },
            { key: "expiry", label: "Points expiry" },
            { key: "updated", label: "Updated" },
          ]}
          rows={tableRows}
          sortable
          filterable
          filterPlaceholder="Filter programmes…"
          pageSize={25}
        />
      )}
    </div>
  );
}
