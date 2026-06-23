"use client";

import { useState } from "react";
import Link from "next/link";
import { StatusPill, EmptyState } from "../../../../_components/ds";
import type { SanctionSummary } from "@civitasone/types";
import { formatIndianDate } from "@/lib/formatters";
import { useSeededResource } from "@/lib/sync/resource";

type Tab = "All" | "Pending" | "Sanctioned";

const TABS: Tab[] = ["All", "Pending", "Sanctioned"];

const TAB_STATUS_MAP: Record<Tab, string[]> = {
  All: [],
  Pending: ["pending"],
  Sanctioned: ["approved"],
};

export function SanctionsTable({ sanctions, source = "api" }: { sanctions: SanctionSummary[]; source?: "api" | "error" }) {
  const [activeTab, setActiveTab] = useState<Tab>("All");
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<SanctionSummary[]>(
    "finance.sanctions",
    sanctions,
    source,
    (d) => d.length === 0,
  );

  const filtered =
    activeTab === "All"
      ? rows
      : rows.filter((s) => TAB_STATUS_MAP[activeTab].includes(s.status));

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
      <div className="seg">
        {TABS.map((tab) => (
          <span
            key={tab}
            className={activeTab === tab ? "on" : ""}
            onClick={() => setActiveTab(tab)}
            style={{ cursor: "pointer" }}
          >
            {tab}
          </span>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon="🖊️" title="No sanctions found" message="No sanctions match the selected filter." />
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>Sanction</th>
              <th>Purpose</th>
              <th>Head</th>
              <th className="num">Amount</th>
              <th>Sanctioned By</th>
              <th>Date</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.id} className="clickable">
                <td><Link href={`/finance/budget/sanctions/${s.id}`} className="row-link"><span className="mono">{s.sanctionNo}</span></Link></td>
                <td>{s.subject}</td>
                <td>{s.majorHead}</td>
                <td className="num">₹{(s.amount / 100).toLocaleString("en-IN")}</td>
                <td>{s.sanctionedBy}</td>
                <td>{formatIndianDate(s.date)}</td>
                <td><StatusPill status={s.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
