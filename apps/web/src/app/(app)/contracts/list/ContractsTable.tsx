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
        // sublabel is the vendor id (contract-service has no joined vendor
        // display name yet); meta is the contract number -- previously
        // mislabeled "Type" even though contract-service has no concept of a
        // contract type, because the generic row mapper's fallback chain
        // happened to land on contractNo.
        { key: "sublabel", label: "Vendor ID" },
        { key: "meta", label: "Contract No." },
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
