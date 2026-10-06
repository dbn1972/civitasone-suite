"use client";

import { useMemo } from "react";
import { Card, DataTable, EmptyState, StatGrid, StatCard, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { formatIndianDate, daysUntilIST } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import type { EmpanelmentEntry } from "../../../_data/loaders";

type EmpanelmentRow = {
  id: string;
  vendorName: string;
  category: string;
  validUntil: string;
  expiry: string;
  rating: string;
  status: string;
} & Record<string, unknown>;

/**
 * GAP-PROCUREMENT-EMPANELMENT-02: render a rating to ONE decimal with a "/5"
 * scale, guarding a non-finite value to "—" rather than printing "4.1666667/5".
 */
function formatRating(rating: number): string {
  return Number.isFinite(rating) ? `${Number(rating).toFixed(1)}/5` : "—";
}

/**
 * GAP-PROCUREMENT-EMPANELMENT-04: an expiry cue computed from the validUntil
 * date (text wording, not colour alone), independent of the server status
 * string. "—" when the date is missing/unparseable.
 */
function expiryLabel(validUntil: string): string {
  const days = daysUntilIST(validUntil);
  if (days === null) return "—";
  if (days < 0) return `Expired ${-days} day${-days === 1 ? "" : "s"} ago`;
  if (days === 0) return "Expires today";
  return `Expires in ${days} day${days === 1 ? "" : "s"}`;
}

export function EmpanelmentTable({ vendors, source = "api" }: { vendors: EmpanelmentEntry[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<EmpanelmentEntry[]>(
    "procurement.empanelment",
    vendors,
    source,
    (d) => d.length === 0,
  );

  const errored = provenance === "error-no-data";

  const tableRows = useMemo<EmpanelmentRow[]>(
    () =>
      rows.map((v) => ({
        id: v.id,
        vendorName: v.vendorName,
        category: v.category,
        // GAP-PROCUREMENT-EMPANELMENT-04: dd Mon yyyy, not the raw string.
        validUntil: formatIndianDate(v.validUntil),
        expiry: expiryLabel(v.validUntil),
        rating: formatRating(v.rating),
        status: v.status,
      })),
    [rows],
  );

  // GAP-PROCUREMENT-EMPANELMENT-01/03: stats derived from the SAME rows the
  // table renders. On a failed fetch with no cache they read "—", never a
  // fabricated 0 that would read as "no vendors empanelled".
  const total = errored ? "—" : rows.length;
  const active = errored ? "—" : rows.filter((v) => v.status === "Active").length;
  const expiring = errored ? "—" : rows.filter((v) => v.status === "Expiring").length;
  // GAP-PROCUREMENT-EMPANELMENT-02: average rating over NON-Expired vendors
  // only (an expired empanelment should not drag the live panel's quality
  // figure), shown on the same "/5" scale. "—" when there are none / errored.
  const avgRating = useMemo(() => {
    if (errored) return "—";
    const live = rows.filter((v) => v.status !== "Expired" && Number.isFinite(v.rating));
    if (live.length === 0) return "—";
    const mean = live.reduce((sum, v) => sum + v.rating, 0) / live.length;
    return `${mean.toFixed(1)}/5`;
  }, [rows, errored]);

  return (
    <>
      <StatGrid>
        <StatCard icon="🏢" iconBg="#eef2ff" label="Total Empanelled" value={total} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={active} />
        <StatCard icon="⏰" iconBg="#fffaeb" label="Expiring Soon" value={expiring} />
        <StatCard icon="⭐" iconBg="#fce7ee" label="Avg. Rating (active)" value={avgRating} />
      </StatGrid>

      <Card title="Empanelled Vendors">
        {provenance === "cached" ? (
          <DataSourceBadge provenance="cached" cachedAt={cachedAt} offline={offline} />
        ) : null}
        {errored ? (
          // GAP-PROCUREMENT-EMPANELMENT-01: a failed fetch is a real error with a
          // retry — NOT "No empanelled vendors", which would falsely read as
          // "none empanelled" and silently block RFQ invitations.
          <RefreshErrorState error={toHumanError("load", { area: "empanelled vendors" })} />
        ) : tableRows.length === 0 ? (
          <EmptyState icon="🏢" title="No empanelled vendors" message="Vendors will appear here once empanelled." />
        ) : (
          <DataTable<EmpanelmentRow>
            rows={tableRows}
            sortable
            filterable
            filterPlaceholder="Search vendor, category…"
            pageSize={15}
            exportable
            exportFilename="vendor-empanelment"
            columns={[
              { key: "vendorName", label: "Vendor Name" },
              { key: "category", label: "Category" },
              { key: "validUntil", label: "Valid Until" },
              { key: "expiry", label: "Expiry" },
              { key: "rating", label: "Rating", align: "center" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
          />
        )}
      </Card>
    </>
  );
}
