"use client";

import { useMemo, useState } from "react";
import { Card, DataTable, StatusPill, EmptyState, Segmented, RefreshErrorState } from "../../../_components/ds";
import { maskPhone } from "../../../_components/ds/Masked";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { toHumanError } from "@/lib/messages";

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

const STATUS_FILTERS = ["All", "Empanelled", "Provisional", "Not Empanelled", "Blacklisted"] as const;
const FILTER_TO_STATUS: Record<string, string | null> = {
  All: null,
  Empanelled: "empanelled",
  Provisional: "provisional",
  "Not Empanelled": "not_empanelled",
  Blacklisted: "blacklisted",
};

export function VendorsTable({ vendors, source = "api", truncated = false, limit }: { vendors: Vendor[]; source?: "api" | "error"; truncated?: boolean; limit?: number }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Vendor[]>(
    "procurement.vendors",
    vendors,
    source,
    (d) => d.length === 0,
  );
  const [statusFilter, setStatusFilter] = useState<string>("All");

  // GAP-...-VENDORS-04: tiles are computed from the SAME `rows` the table
  // renders (not a second, independent read), so they can never disagree.
  // When there is no data AND the load errored, every tile reads "—" (a
  // fabricated 0 is indistinguishable from a genuine zero) and the body shows
  // a retryable error state, not "No vendors found".
  const erroredNoData = rows.length === 0 && source === "error";
  const countOf = (status: string) => rows.filter((v) => v.empanelmentStatus === status).length;
  // GAP-...-VENDORS-05: a "Not Empanelled" tile is included so the status
  // tiles sum to Total Vendors (previously not_empanelled was uncounted).
  const tiles = [
    { icon: "🏢", label: "Total Vendors", value: erroredNoData ? "—" : rows.length },
    { icon: "✅", label: "Empanelled", value: erroredNoData ? "—" : countOf("empanelled") },
    { icon: "⏳", label: "Provisional", value: erroredNoData ? "—" : countOf("provisional") },
    { icon: "📝", label: "Not Empanelled", value: erroredNoData ? "—" : countOf("not_empanelled") },
    { icon: "🚫", label: "Blacklisted", value: erroredNoData ? "—" : countOf("blacklisted") },
  ];

  const wantStatus = FILTER_TO_STATUS[statusFilter];
  const tableRows = useMemo<VendorRow[]>(
    () =>
      rows
        .filter((v) => wantStatus === null || v.empanelmentStatus === wantStatus)
        .map((v) => ({
          id: v.id,
          vendorCode: v.vendorCode,
          name: v.name,
          gstin: v.gstin ?? "—",
          category: v.category,
          empanelmentStatus: v.empanelmentStatus,
          // GAP-...-VENDORS-05: same scale/label as detail+scorecard context —
          // this is the buyer rating (0-5), distinct from the /100 scorecard.
          rating: v.rating !== undefined ? `${v.rating}/5` : "—",
          // GAP-...-VENDORS-02 (DPDP): show the contact person; when only a
          // phone exists, show it MASKED (never the raw number), so neither the
          // cell nor the DataTable global filter indexes the clear value.
          contact: v.contactPerson ?? (v.phone ? maskPhone(v.phone) : "—"),
        })),
    [rows, wantStatus],
  );

  return (
    <Card title="Vendor directory">
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />

      <div className="statgrid" style={{ marginBottom: 16 }}>
        {tiles.map((t) => (
          <div key={t.label} className="stat">
            <div className="top"><div /><div className="ic" aria-hidden style={{ lineHeight: 1 }}>{t.icon}</div></div>
            <div className="lab">{t.label}</div>
            <div className="val">{String(t.value)}</div>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 12 }}>
        <Segmented options={[...STATUS_FILTERS]} value={statusFilter} onChange={setStatusFilter} />
      </div>

      {truncated && !erroredNoData ? (
        <p role="status" className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
          Showing the first {limit ?? vendors.length} vendors. Refine your search to find vendors beyond this list.
        </p>
      ) : null}

      {erroredNoData ? (
        <RefreshErrorState
          error={toHumanError("load", { area: "vendors" })}
          source={{ area: "vendors" }}
        />
      ) : tableRows.length === 0 ? (
        <EmptyState
          icon="🏢"
          title="No vendors found"
          message={statusFilter === "All" ? "Register a vendor to get started." : `No ${statusFilter.toLowerCase()} vendors.`}
        />
      ) : (
        <DataTable<VendorRow>
          rows={tableRows}
          rowHref={(row) => `/procurement/vendors/${row.id}`}
          identifyingColumnKey="name"
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
