"use client";

import { DataTable, StatusPill } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";

export type BeneficiaryRow = {
  id: string;
  name: string;
  project: string;
  district: string;
  category: string;
  verified: string;
  disbursement: string;
} & Record<string, unknown>;

// GAP-PROJECTS-BENEFICIARIES-02: the "Verified" column raw-humanized the enum,
// so an "active" beneficiary read "Active" (not "Verified") and "rejected" read
// "Rejected" with no distinct meaning. Map the enum to the register's own labels.
const VERIFIED_LABEL: Record<string, string> = {
  active: "Verified",
  pending: "Pending",
  rejected: "Rejected",
};
const VERIFIED_VARIANT: Record<string, "good" | "warn" | "bad"> = {
  active: "good",
  pending: "warn",
  rejected: "bad",
};

const COLUMNS: {
  key: keyof BeneficiaryRow & string;
  label: string;
  cellType?: "status" | "amount";
  render?: (row: BeneficiaryRow) => React.ReactNode;
}[] = [
  { key: "id", label: "Beneficiary ID" },
  { key: "name", label: "Name" },
  { key: "project", label: "Project" },
  { key: "district", label: "District" },
  { key: "category", label: "Category" },
  {
    key: "verified",
    label: "Verified",
    render: (r) => {
      const v = String(r.verified).toLowerCase();
      return <StatusPill status={v} label={VERIFIED_LABEL[v] ?? r.verified} variant={VERIFIED_VARIANT[v]} />;
    },
  },
  { key: "disbursement", label: "Disbursement (₹)" },
];

export function BeneficiariesTable({ rows, source = "api", canExport = false }: { rows: BeneficiaryRow[]; source?: "api" | "error"; canExport?: boolean }) {
  const { data, fromCache, offline, cachedAt } = useSeededResource<BeneficiaryRow[]>(
    "projects.beneficiaries",
    rows,
    source,
    (d) => d.length === 0,
  );

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
      {/* GAP-PROJECTS-BENEFICIARIES-01 (DPDP): the one-click client-side CSV export
          downloaded all beneficiary PII + social category with no role gate and no
          audit event. It is now disabled by default (canExport=false) — a PII bulk
          export must go through an audited server endpoint (CLAUDE.md: audit event
          on every PII egress). Flagged for HUMAN REVIEW. */}
      <DataTable<BeneficiaryRow>
        columns={COLUMNS}
        rows={data}
        sortable
        filterable
        filterPlaceholder="Filter beneficiaries…"
        pageSize={15}
        {...(canExport ? { exportable: true, exportFilename: "project-beneficiaries" } : {})}
        emptyIcon="🔍"
        emptyTitle="No matching beneficiaries"
        emptyMessage="No beneficiaries match the current filter. Clear the filter to see all registered beneficiaries."
      />
    </>
  );
}
