"use client";

import { DataTable } from "@/app/_components/ds";

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

export function BeneficiariesTable({ rows }: { rows: BeneficiaryRow[] }) {
  return (
    <DataTable<BeneficiaryRow>
      columns={COLUMNS}
      rows={rows}
      sortable
      filterable
      filterPlaceholder="Filter beneficiaries…"
      pageSize={15}
    />
  );
}
