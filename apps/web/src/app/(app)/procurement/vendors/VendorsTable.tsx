"use client";

import { useMemo } from "react";
import { Card, DataTable, StatusPill, EmptyState } from "../../../_components/ds";
import { useSeededResource } from "@/lib/sync/resource";

type Vendor = {
  id: string;
  vendorCode: string;
  name: string;
  gstin?: string | null;
  category: string;
  empanelmentStatus: string;
  rating?: number;
  contactPerson?: string | null;
  phone?: string | null;
} & Record<string, unknown>;

const EMPANELMENT_LABELS: Record<string, string> = {
  empanelled: "Empanelled",
  provisional: "Provisional",
  blacklisted: "Blacklisted",
  not_empanelled: "Not Empanelled",
};

type VendorRow = {
  id: string;
  vendorCode: string;
  name: string;
  gstin: string;
  category: string;
  empanelmentStatus: string;
  rating: string;
  contact: string;
} & Record<string, unknown>;

export function VendorsTable({ vendors, source = "api" }: { vendors: Vendor[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Vendor[]>(
    "procurement.vendors",
    vendors,
    source,
    (d) => d.length === 0,
  );

  const tableRows = useMemo<VendorRow[]>(
    () =>
      rows.map((v) => ({
        id: v.id,
        vendorCode: v.vendorCode,
        name: v.name,
        gstin: v.gstin ?? "—",
        category: v.category,
        empanelmentStatus: v.empanelmentStatus,
        rating: v.rating !== undefined ? `${v.rating}/5` : "—",
        contact: v.contactPerson ?? v.phone ?? "—",
      })),
    [rows],
  );

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <Card title="Vendor directory">
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0", padding: "8px 16px 0" }}>
          {cacheNote}
        </p>
      ) : null}
      {tableRows.length === 0 ? (
        <EmptyState icon="🏢" title="No vendors found" message="Register a vendor to get started." />
      ) : (
        <DataTable<VendorRow>
          rows={tableRows}
          rowHref={(row) => `/procurement/vendors/${row.id}`}
          sortable
          filterable
          filterPlaceholder="Search name, code, GSTIN…"
          pageSize={10}
          columns={[
            { key: "vendorCode", label: "Code" },
            { key: "name", label: "Name" },
            { key: "gstin", label: "GSTIN" },
            { key: "category", label: "Category" },
            {
              key: "empanelmentStatus",
              label: "Empanelment",
              render: (row) => (
                <StatusPill
                  status={row.empanelmentStatus}
                  label={EMPANELMENT_LABELS[row.empanelmentStatus] ?? row.empanelmentStatus}
                />
              ),
            },
            { key: "rating", label: "Rating", align: "right" },
            { key: "contact", label: "Contact" },
          ]}
        />
      )}
    </Card>
  );
}
