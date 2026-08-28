"use client";

import Link from "next/link";
import { DataTable, StatusPill } from "../../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { useSeededResource } from "@/lib/sync/resource";

type Bill = {
  id: string;
  billNo: string;
  vendor: string;
  poRef?: string | null;
  amount: string;
  submittedDate: string;
  dueDate?: string | null;
  threeWayMatch: string;
  status: string;
};

export function BillsTable({ bills, source = "api" }: { bills: Bill[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Bill[]>(
    "finance.bills",
    bills,
    source,
    (d) => d.length === 0,
  );

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <>
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>
          {cacheNote}
        </p>
      ) : null}
      <DataTable<Bill>
        columns={[
          { key: "billNo", label: "Bill", render: (b) => <span className="mono">{b.billNo}</span> },
          { key: "vendor", label: "Vendor" },
          { key: "poRef", label: "PO Ref", render: (b) => b.poRef ?? "—" },
          { key: "amount", label: "Amount", align: "right", cellType: "amount" },
          { key: "submittedDate", label: "Submitted", render: (b) => formatIndianDate(b.submittedDate) },
          { key: "dueDate", label: "Due", render: (b) => (b.dueDate ? formatIndianDate(b.dueDate) : "—") },
          { key: "threeWayMatch", label: "3-Way Match", render: (b) => <StatusPill status={b.threeWayMatch} label={b.threeWayMatch.replace("_", " ")} /> },
          { key: "status", label: "Status", render: (b) => <StatusPill status={b.status} label={b.status.replace("_", " ")} /> },
        ]}
        rows={rows}
        rowHref={(b) => `/finance/expenditure/bills/${b.id}`}
        sortable
        filterable
        filterPlaceholder="Search bills…"
        pageSize={15}
        exportable
        emptyIcon="🧾"
        emptyTitle="No bills yet"
        emptyMessage="When you receive a vendor bill, record it here to pre-audit, approve and pay it."
        emptyAction={
          <Link href="/help/finance" className="btn ghost" style={{ marginTop: 10 }}>
            How bills work
          </Link>
        }
      />
    </>
  );
}
