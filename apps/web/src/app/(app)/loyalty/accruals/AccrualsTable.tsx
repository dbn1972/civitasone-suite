"use client";

import { DataTable, EmptyState } from "../../../_components/ds";
import { RefreshErrorState } from "../../../_components/ds/RefreshErrorState";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { formatIndianDate, formatPoints, formatShortId, humanizeStatus } from "@/lib/formatters";
import type { LoyaltyAccrualRow } from "../_data";

/**
 * GAP-LOYALTY-ACCRUALS-01: the points ledger — one row per accrual transaction
 * (date, type, source, points earned, expiry), not the per-enrolment position
 * the page showed while loyalty-service had no tenant-wide accruals endpoint.
 * The enrolment is an opaque reference shown shortened (full id in the title);
 * the payload carries no member name, phone or email.
 */

type AccrualTableRow = {
  id: string;
  date: string;
  type: string;
  source: string;
  enrolment: string;
  points: string;
  expires: string;
};

export function AccrualsTable({ rows, source }: { rows: LoyaltyAccrualRow[]; source: "api" | "error" }) {
  const { data, provenance, offline, cachedAt } = useSeededResource<LoyaltyAccrualRow[]>(
    "loyalty.accruals",
    rows,
    source,
    (d) => d.length === 0,
  );

  if ((provenance ?? "live") === "error-no-data") {
    return (
      <div className="card">
        <RefreshErrorState
          error={{
            what: "We couldn't load accruals.",
            next: "Check your connection and try again.",
            actions: ["retry", "help"],
          }}
          backHref="/loyalty"
        />
      </div>
    );
  }

  const tableRows: AccrualTableRow[] = data.map((a) => ({
    id: a.id,
    date: a.accrualDate ? formatIndianDate(a.accrualDate) : "—",
    type: a.txType ? humanizeStatus(a.txType) : "—",
    source: a.source ? humanizeStatus(a.source) : "—",
    enrolment: formatShortId(a.enrolmentId),
    points: formatPoints(a.points),
    expires: a.expiresAt ? formatIndianDate(a.expiresAt) : "No expiry",
  }));

  return (
    <div className="card">
      <div className="card-h">
        <h3>Points ledger</h3>
      </div>
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      {tableRows.length === 0 ? (
        <EmptyState icon="➕" title="No accruals" message="No points have been accrued yet." />
      ) : (
        <DataTable<AccrualTableRow>
          columns={[
            { key: "date", label: "Date" },
            { key: "type", label: "Type" },
            { key: "source", label: "Source" },
            { key: "enrolment", label: "Enrolment ref" },
            { key: "points", label: "Points", align: "right" },
            { key: "expires", label: "Expires" },
          ]}
          rows={tableRows}
          sortable
          filterable
          filterPlaceholder="Filter accruals…"
          pageSize={25}
        />
      )}
    </div>
  );
}
