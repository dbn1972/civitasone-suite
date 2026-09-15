"use client";

import { useMemo } from "react";
import { Card, DataTable, EmptyState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import type { EmdBgEntry } from "../../../_data/loaders";

type EmdRow = {
  id: string;
  vendor: string;
  type: string;
  amount: string;
  validity: string;
  bank: string;
  status: string;
} & Record<string, unknown>;

export function EmdBgTable({ entries, source = "api" }: { entries: EmdBgEntry[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<EmdBgEntry[]>(
    "procurement.emd_bg",
    entries,
    source,
    (d) => d.length === 0,
  );

  const tableRows = useMemo<EmdRow[]>(
    () =>
      rows.map((e) => ({
        id: e.id,
        vendor: e.vendor,
        type: e.type,
        amount: `₹${(e.amount / 100).toLocaleString("en-IN")}`,
        validity: e.validity,
        bank: e.bank,
        status: e.status,
      })),
    [rows],
  );

  return (
    <Card title="EMD & BG Register">
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
        <EmptyState icon="🏦" title="No EMD/BG records" message="Earnest money deposits and bank guarantees will appear here." />
      ) : (
        <DataTable<EmdRow>
          rows={tableRows}
          sortable
          filterable
          filterPlaceholder="Search vendor, bank, type…"
          pageSize={15}
          exportable
          exportFilename="emd-bank-guarantees"
          columns={[
            { key: "vendor", label: "Vendor" },
            { key: "type", label: "Type" },
            { key: "amount", label: "Amount (₹)", align: "right" },
            { key: "validity", label: "Valid Until" },
            { key: "bank", label: "Bank" },
            { key: "status", label: "Status", cellType: "status" },
          ]}
        />
      )}
    </Card>
  );
}
