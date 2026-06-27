"use client";

import Link from "next/link";
import { DataTable } from "../../../_components/ds";

type ContractRow = {
  id: string;
  label: string;
  sublabel: string;
  status: string;
  meta: string;
} & Record<string, unknown>;

export function ContractsTable({ rows }: { rows: ContractRow[] }) {
  return (
    <DataTable<ContractRow>
      columns={[
        {
          key: "label",
          label: "Title",
          render: (r) => (
            <Link href={`/contracts/${r.id}`} className="lnk">
              {r.label}
            </Link>
          ),
        },
        { key: "sublabel", label: "Party / Info" },
        { key: "meta", label: "Type" },
        {
          key: "status",
          label: "Status",
          render: (r) => {
            const s = r.status.toLowerCase();
            const cls = s === "active" ? "good" : s === "expired" ? "bad" : "mut";
            return <span className={`pill ${cls}`}>{r.status}</span>;
          },
        },
      ]}
      rows={rows}
    />
  );
}
