"use client";

import { DataTable } from "@/app/_components/ds";
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

const COLUMNS: {
  key: keyof BeneficiaryRow & string;
  label: string;
  cellType?: "status" | "amount";
}[] = [
  { key: "id", label: "Beneficiary ID" },
  { key: "name", label: "Name" },
  { key: "project", label: "Project" },
  { key: "district", label: "District" },
  { key: "category", label: "Category" },
  { key: "verified", label: "Verified", cellType: "status" },
  { key: "disbursement", label: "Disbursement (₹)" },
];

export function BeneficiariesTable({ rows, source = "api" }: { rows: BeneficiaryRow[]; source?: "api" | "error" }) {
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
      <DataTable<BeneficiaryRow>
        columns={COLUMNS}
        rows={data}
        sortable
        filterable
        filterPlaceholder="Filter beneficiaries…"
        pageSize={15}
        exportable
        exportFilename="project-beneficiaries"
        emptyIcon="👥"
        emptyTitle="No beneficiaries"
        emptyMessage="No beneficiaries match the current filter."
      />
    </>
  );
}
