"use client";

import { useMemo } from "react";
import { Card, DataTable, EmptyState } from "../../../_components/ds";
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
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<EmdBgEntry[]>(
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

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <Card title="EMD & BG Register">
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0", padding: "8px 16px 0" }}>
          {cacheNote}
        </p>
      ) : null}
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
