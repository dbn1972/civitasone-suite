"use client";
import { DataTable } from "@/app/_components/ds";
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

export function FundReleasesTable({ releases, source = "api" }: { releases: Row[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Row[]>(
    "finance.fund-releases", releases, source, (d) => d.length === 0
  );
  const cacheNote = offline || fromCache
    ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
    : null;

  const enriched = rows.map((r) => ({
    ...r,
    _amount:   rupees(r.amountMinor),
    _status:   statusBadge(r.status),
    _from:     String(r.fromOfficeId ?? "-").slice(-8),
    _to:       String(r.toOfficeId ?? "-").slice(-8),
    _issued:   r.issuedBy ? String(r.issuedBy).slice(-8) : "-",
    _effFrom:  String(r.effectiveFrom ?? "-").slice(0, 10),
  }));

  return (
    <>
      {cacheNote && (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>
          {cacheNote}
        </p>
      )}
      <DataTable<Row>
        columns={[
          { key: "id",        label: "ID" },
          { key: "fy",        label: "FY" },
          { key: "_from",     label: "From Office" },
          { key: "_to",       label: "To Office" },
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
