"use client";

import { useMemo } from "react";
import { Card, DataTable, EmptyState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
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
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<EmpanelmentEntry[]>(
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

  return (
    <Card title="Empanelled Vendors">
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge
        provenance={provenance ?? "live"}
        cachedAt={cachedAt}
        offline={offline}
        message={provenance === "error-no-data" ? "Couldn't load — showing nothing" : undefined}
      />
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
