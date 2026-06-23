"use client";

import { useState } from "react";
import { StatusPill, EmptyState } from "../../../../_components/ds";
import type { AdvanceSummary } from "@civitasone/types";
import { formatIndianDate } from "@/lib/formatters";
import { useSeededResource } from "@/lib/sync/resource";

type Tab = "All" | "Open" | "Overdue";

const TABS: Tab[] = ["All", "Open", "Overdue"];

const TAB_STATUS_MAP: Record<Tab, string[]> = {
  All: [],
  Open: ["active"],
  Overdue: ["overdue"],
};

export function AdvancesTable({ advances, source = "api" }: { advances: AdvanceSummary[]; source?: "api" | "error" }) {
  const [activeTab, setActiveTab] = useState<Tab>("All");
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<AdvanceSummary[]>(
    "finance.advances",
    advances,
    source,
    (d) => d.length === 0,
  );

  const filtered =
    activeTab === "All"
      ? rows
      : rows.filter((a) => TAB_STATUS_MAP[activeTab].includes(a.status));

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
        <EmptyState icon="💵" title="No advances found" message="No advances match the selected filter." />
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>Advance No</th>
              <th>Officer / Party</th>
              <th>Purpose</th>
              <th className="num">Advance</th>
              <th className="num">Settled</th>
              <th className="num">Balance</th>
              <th>Disbursed</th>
              <th>Due</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) => (
              <tr key={a.id}>
                <td><span className="mono">{a.advanceNo}</span></td>
                <td>{a.beneficiary}</td>
                <td style={{ textTransform: "capitalize" }}>{a.type}</td>
                <td className="num">₹{(a.amount / 100).toLocaleString("en-IN")}</td>
                <td className="num">₹{(a.adjustedAmount / 100).toLocaleString("en-IN")}</td>
                <td className="num">₹{(a.balance / 100).toLocaleString("en-IN")}</td>
                <td>{formatIndianDate(a.disbursedDate)}</td>
                <td>{formatIndianDate(a.dueDate)}</td>
                <td><StatusPill status={a.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
