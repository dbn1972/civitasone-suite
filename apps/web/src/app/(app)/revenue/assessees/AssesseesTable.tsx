"use client";

import { DataTable } from "@/app/_components/ds";
import { labelForType } from "./assesseeTypes";

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

export function AssesseesTable({ assessees, searching = false }: { assessees: AssesseeRow[]; searching?: boolean }) {
  const rows: Row[] = assessees.map((a) => ({ ...a, statusLabel: a.isActive ? "active" : "inactive" }));

  return (
    <DataTable<Row>
      columns={[
        { key: "identifierNo", label: "Identifier No." },
        { key: "ownerName", label: "Owner / Holder" },
        { key: "assesseeType", label: "Type", render: (r) => labelForType(r.assesseeType) },
        { key: "wardNo", label: "Ward" },
        { key: "propertyType", label: "Property Type" },
        { key: "statusLabel", label: "Status", cellType: "status" },
      ]}
      rows={rows}
      rowLinkKey="id"
      rowLinkPrefix="/revenue/assessees/"
      sortable
      pageSize={15}
      emptyIcon="🧾"
      emptyTitle={searching ? "No assessees match your search" : "No assessees registered"}
      emptyMessage={
        searching
          ? "Try a different owner name or identifier."
          : "Taxpayers/property or water-connection holders will appear here once registered."
      }
    />
  );
}
