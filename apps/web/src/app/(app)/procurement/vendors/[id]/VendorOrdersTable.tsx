"use client";

import Link from "next/link";
import { DataTable, StatusPill } from "../../../../_components/ds";

export type VendorPoRow = {
  id: string;
  poNo: string;
  orderDateDisplay: string;
  status: string;
  amountDisplay: string;
};

export function VendorOrdersTable({ rows }: { rows: VendorPoRow[] }) {
  return (
    <DataTable<VendorPoRow>
      rows={rows}
      pageSize={25}
      columns={[
        {
          key: "poNo",
          label: "PO No",
          render: (r) => (
            <Link href={`/procurement/orders/${r.id}`} className="mono">
              {r.poNo}
            </Link>
          ),
        },
        { key: "orderDateDisplay", label: "Date" },
        {
          key: "status",
          label: "Status",
          render: (r) => (
            <StatusPill status={r.status} label={r.status.replace(/_/g, " ")} />
          ),
        },
        {
          key: "amountDisplay",
          label: "Amount",
          render: (r) => (
            <span className="mono" style={{ display: "block", textAlign: "end" }}>
              {r.amountDisplay}
            </span>
          ),
        },
      ]}
    />
  );
}
