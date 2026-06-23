"use client";

import { useState } from "react";
import { StatusPill, EmptyState } from "../../../../_components/ds";
import type { BudgetSummary } from "@civitasone/types";
import { useSeededResource } from "@/lib/sync/resource";

type Tab = "All" | "Submitted" | "Approved" | "Pending";

const TABS: Tab[] = ["All", "Submitted", "Approved", "Pending"];

const TAB_STATUS_MAP: Record<Tab, string[]> = {
  All: [],
  Submitted: ["submitted"],
  Approved: ["approved"],
  Pending: ["pending"],
};

export function FormulationTable({ budgets, source = "api" }: { budgets: BudgetSummary[]; source?: "api" | "error" }) {
  const [activeTab, setActiveTab] = useState<Tab>("All");
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<BudgetSummary[]>(
    "finance.budgets",
    budgets,
    source,
    (d) => d.length === 0,
  );

  const filtered =
    activeTab === "All"
      ? rows
      : rows.filter((b) => TAB_STATUS_MAP[activeTab].includes(b.status));

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
        <EmptyState icon="📝" title="No budget estimates" message="No estimates match the selected filter." />
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>Major Head</th>
              <th>Sub Head</th>
              <th className="num">Last Year (BE)</th>
              <th className="num">Proposed (BE)</th>
              <th className="num">Expenditure</th>
              <th className="num">Balance</th>
              <th>FY</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((b) => (
              <tr key={b.id}>
                <td>{b.majorHead}</td>
                <td>{b.subHead ?? "—"}</td>
                <td className="num">₹{(b.releasedAmount / 100).toLocaleString("en-IN")}</td>
                <td className="num">₹{(b.sanctionedAmount / 100).toLocaleString("en-IN")}</td>
                <td className="num">₹{(b.expenditure / 100).toLocaleString("en-IN")}</td>
                <td className="num">₹{(b.balance / 100).toLocaleString("en-IN")}</td>
                <td>{b.financialYear}</td>
                <td><StatusPill status={b.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
