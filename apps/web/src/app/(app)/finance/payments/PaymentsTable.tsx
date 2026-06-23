"use client";

import { useState } from "react";
import { Card, StatusPill, EmptyState } from "../../../_components/ds";
import { useSeededResource } from "@/lib/sync/resource";

type Payment = {
  referenceId: string;
  beneficiary: string;
  amountDisplay: string;
  status: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatReference(ref: string): string {
  if (UUID_RE.test(ref)) {
    return "PAY-" + ref.slice(-6).toUpperCase();
  }
  return ref;
}

type Tab = "all" | "pending" | "released";

export function PaymentsTable({ payments, source = "api" }: { payments: Payment[]; source?: "api" | "error" }) {
  const [activeTab, setActiveTab] = useState<Tab>("all");
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Payment[]>(
    "finance.payments",
    payments,
    source,
    (d) => d.length === 0,
  );

  const filtered = rows.filter((p) => {
    if (activeTab === "pending") return p.status === "Pending Approval";
    if (activeTab === "released") return p.status === "Released";
    return true;
  });

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <Card
      title="Payments register"
      link={
        <div className="seg">
          <span
            className={activeTab === "all" ? "on" : ""}
            style={{ cursor: "pointer" }}
            onClick={() => setActiveTab("all")}
          >
            All
          </span>
          <span
            className={activeTab === "pending" ? "on" : ""}
            style={{ cursor: "pointer" }}
            onClick={() => setActiveTab("pending")}
          >
            Pending
          </span>
          <span
            className={activeTab === "released" ? "on" : ""}
            style={{ cursor: "pointer" }}
            onClick={() => setActiveTab("released")}
          >
            Released
          </span>
        </div>
      }
    >
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>
          {cacheNote}
        </p>
      ) : null}
      {filtered.length === 0 ? (
        <EmptyState icon="💳" title="No payments found" message="Payments will appear here once bills are passed." />
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>Reference</th>
              <th>Beneficiary</th>
              <th className="num">Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.referenceId}>
                <td><span className="mono">{formatReference(p.referenceId)}</span></td>
                <td>{p.beneficiary}</td>
                <td className="num">{p.amountDisplay}</td>
                <td><StatusPill status={p.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
