"use client";

import Link from "next/link";
import { StatusPill, EmptyState } from "../../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { useSeededResource } from "@/lib/sync/resource";

type Bill = {
  id: string;
  billNo: string;
  vendor: string;
  poRef?: string | null;
  amount: number;
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
      {rows.length === 0 ? (
        <EmptyState icon="🧮" title="No bills found" message="Submit a new bill to get started." />
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>Bill</th>
              <th>Vendor</th>
              <th>PO Ref</th>
              <th className="num">Amount</th>
              <th>Submitted</th>
              <th>Due</th>
              <th>3-Way Match</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id} className="clickable">
                <td><Link href={`/finance/expenditure/bills/${b.id}`} className="row-link"><span className="mono">{b.billNo}</span></Link></td>
                <td>{b.vendor}</td>
                <td>{b.poRef ?? "—"}</td>
                <td className="num">₹{(b.amount / 100).toLocaleString("en-IN")}</td>
                <td>{formatIndianDate(b.submittedDate)}</td>
                <td>{b.dueDate ?? "—"}</td>
                <td><StatusPill status={b.threeWayMatch} label={b.threeWayMatch.replace("_", " ")} /></td>
                <td><StatusPill status={b.status} label={b.status.replace("_", " ")} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
