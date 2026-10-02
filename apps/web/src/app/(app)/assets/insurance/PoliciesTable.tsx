"use client";

import { DataTable } from "@/app/_components/ds";
import { AssetLink } from "./AssetLink";

export type PolicyTableRow = {
  id: string;
  assetId: string;
  assetLabel: string;
  policyNo: string;
  insurer: string;
  coverageMinor: string;
  premiumMinor: string;
  startDateDisplay: string;
  endDateDisplay: string;
  status: string;
} & Record<string, unknown>;

/**
 * Client component so the Asset column can carry a `render` function (a render
 * prop cannot cross the Server -> Client boundary). Receives plain rows only.
 */
export function PoliciesTable({ rows }: { rows: PolicyTableRow[] }) {
  return (
    <DataTable<PolicyTableRow>
      columns={[
        { key: "policyNo", label: "Policy No." },
        { key: "assetLabel", label: "Asset", render: (r) => <AssetLink assetId={r.assetId} label={r.assetLabel} /> },
        { key: "insurer", label: "Insurer" },
        { key: "coverageMinor", label: "Sum Insured", align: "right", cellType: "amount" },
        { key: "premiumMinor", label: "Premium", align: "right", cellType: "amount" },
        { key: "startDateDisplay", label: "Start" },
        { key: "endDateDisplay", label: "End" },
        { key: "status", label: "Status", cellType: "status" },
      ]}
      rows={rows}
      rowLinkKey="id"
      rowLinkPrefix="/assets/insurance/"
      sortable
      filterable
      filterPlaceholder="Filter by policy number or insurer…"
      pageSize={15}
      emptyIcon="🛡️"
      emptyTitle="No insurance policies"
      emptyMessage="Create the first policy above to start tracking asset insurance."
    />
  );
}
