"use client";

import { DataTable } from "@/app/_components/ds";

export type AssesseeRow = {
  id: string;
  assesseeType: string;
  identifierNo: string;
  ownerName: string;
  address: string;
  wardNo: string | null;
  zoneNo: string | null;
  propertyType: string | null;
  isActive: boolean;
} & Record<string, unknown>;

type Row = AssesseeRow & { statusLabel: string };

export function AssesseesTable({ assessees }: { assessees: AssesseeRow[] }) {
  const rows: Row[] = assessees.map((a) => ({ ...a, statusLabel: a.isActive ? "active" : "inactive" }));

  return (
    <DataTable<Row>
      columns={[
        { key: "identifierNo", label: "Identifier No." },
        { key: "ownerName", label: "Owner / Holder" },
        { key: "assesseeType", label: "Type" },
        { key: "wardNo", label: "Ward" },
        { key: "propertyType", label: "Property Type" },
        { key: "statusLabel", label: "Status", cellType: "status" },
      ]}
      rows={rows}
      rowLinkKey="id"
      rowLinkPrefix="/revenue/assessees/"
      sortable
      filterable
      filterPlaceholder="Filter by identifier, owner, or ward…"
      pageSize={15}
      emptyIcon="🧾"
      emptyTitle="No assessees registered"
      emptyMessage="Taxpayers/property or water-connection holders will appear here once registered."
    />
  );
}
