"use client";

import Link from "next/link";
import { DataTable } from "@/app/_components/ds";

export type RegisterRow = {
  referenceId: string;
  owner: string;
  dueDisplay: string;
  /** Detail route of the document, when its kind is known. */
  href: string | null;
} & Record<string, unknown>;

/**
 * GAP-PROCUREMENT-APPROVALS-04: the register's Reference cell is a link to the
 * indent / PO it names (it used to be plain text). Client component because a
 * column `render` function cannot be passed from the server page.
 */
export function ApprovalsRegisterTable({ rows }: { rows: RegisterRow[] }) {
  return (
    <DataTable<RegisterRow>
      rows={rows}
      sortable
      filterable
      filterPlaceholder="Filter by reference, owner, due…"
      pageSize={10}
      columns={[
        {
          key: "referenceId",
          label: "Reference",
          render: (row) => row.href
            ? <Link href={row.href} className="mono" style={{ color: "#4f46e5" }}>{row.referenceId}</Link>
            : <span className="mono">{row.referenceId}</span>,
        },
        { key: "owner", label: "Owner" },
        { key: "dueDisplay", label: "Due" },
      ]}
    />
  );
}
