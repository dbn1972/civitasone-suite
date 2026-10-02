"use client";
import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";

type Row = Record<string, unknown>;

function rupees(val: unknown): string {
  const n = Number(BigInt(String(val ?? "0"))) / 100;
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  return `₹${n.toFixed(0)}`;
}

function statusBadge(status: unknown): string {
  switch (String(status)) {
    case "issued":       return "Issued";
    case "acknowledged": return "Acknowledged";
    case "pending":      return "Pending";
    default:             return String(status ?? "-");
  }
}

export const UNKNOWN_OFFICE = "Unknown office";

/** Office display name; never an id fragment (see GAP-FINANCE-BUDGET-FUND-RELEASES-01). */
export function officeLabel(officeId: unknown, names?: ReadonlyMap<string, string>): string {
  const id = typeof officeId === "string" ? officeId : "";
  return (id && names?.get(id)) || UNKNOWN_OFFICE;
}

export function FundReleasesTable({ releases, source = "api" }: { releases: Row[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Row[]>(
    "finance.fund-releases", releases, source, (d) => d.length === 0
  );

  const enriched = rows.map((r) => ({
    ...r,
    _amount:   rupees(r.amountMinor),
    _status:   statusBadge(r.status),
    // GAP-FINANCE-BUDGET-FUND-RELEASES-01: an 8-char uuid tail is not an
    // office name. No office directory backs from/to_office_id yet, so the
    // row says so plainly (full id kept as a tooltip for support) rather
    // than printing a fragment or guessing a name.
    _from:     officeLabel(r.fromOfficeId),
    _to:       officeLabel(r.toOfficeId),
    _issued:   r.issuedBy ? String(r.issuedBy).slice(-8) : "-",
    _effFrom:  String(r.effectiveFrom ?? "-").slice(0, 10),
  }));

  return (
    <>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<Row>
        columns={[
          { key: "fy",        label: "FY" },
          { key: "_from",     label: "From Office", render: (r) => <span title={String(r.fromOfficeId ?? "")}>{String(r._from)}</span> },
          { key: "_to",       label: "To Office",   render: (r) => <span title={String(r.toOfficeId ?? "")}>{String(r._to)}</span> },
          { key: "_amount",   label: "Amount",       align: "right" },
          { key: "currency",  label: "CCY" },
          { key: "_status",   label: "Status" },
          { key: "_effFrom",  label: "Effective" },
        ]}
        rows={enriched}
        sortable
        filterable
        filterPlaceholder="Search releases…"
        pageSize={20}
        exportable
        exportFilename="fund-releases"
        emptyIcon="💸"
        emptyTitle="No fund releases"
        emptyMessage="No allocation distributions found."
      />
    </>
  );
}
