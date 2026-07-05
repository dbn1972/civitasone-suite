"use client";

import { useMemo } from "react";
import { Card, DataTable, EmptyState } from "../../../_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
import type { EmpanelmentEntry } from "../../../_data/loaders";

type EmpanelmentRow = {
  id: string;
  vendorName: string;
  category: string;
  validUntil: string;
  rating: string;
  status: string;
} & Record<string, unknown>;

export function EmpanelmentTable({ vendors, source = "api" }: { vendors: EmpanelmentEntry[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<EmpanelmentEntry[]>(
    "procurement.empanelment",
    vendors,
    source,
    (d) => d.length === 0,
  );

  const tableRows = useMemo<EmpanelmentRow[]>(
    () =>
      rows.map((v) => ({
        id: v.id,
        vendorName: v.vendorName,
        category: v.category,
        validUntil: v.validUntil,
        rating: `${v.rating}/5`,
        status: v.status,
      })),
    [rows],
  );

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <Card title="Empanelled Vendors">
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0", padding: "8px 16px 0" }}>
          {cacheNote}
        </p>
      ) : null}
      {tableRows.length === 0 ? (
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
            { key: "rating", label: "Rating", align: "center" },
            { key: "status", label: "Status", cellType: "status" },
          ]}
        />
      )}
    </Card>
  );
}
