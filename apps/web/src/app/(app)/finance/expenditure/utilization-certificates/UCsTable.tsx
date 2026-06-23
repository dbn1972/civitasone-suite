"use client";

import { useState } from "react";
import { StatusPill, EmptyState } from "../../../../_components/ds";
import type { UCSummary } from "@civitasone/types";
import { formatIndianDate } from "@/lib/formatters";
import { useSeededResource } from "@/lib/sync/resource";

type Tab = "All" | "Pending" | "Submitted";

const TABS: Tab[] = ["All", "Pending", "Submitted"];

const TAB_STATUS_MAP: Record<Tab, string[]> = {
  All: [],
  Pending: ["pending", "rejected"],
  Submitted: ["submitted", "verified"],
};

export function UCsTable({ ucs, source = "api" }: { ucs: UCSummary[]; source?: "api" | "error" }) {
  const [activeTab, setActiveTab] = useState<Tab>("All");
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<UCSummary[]>(
    "finance.ucs",
    ucs,
    source,
    (d) => d.length === 0,
  );

  const filtered =
    activeTab === "All"
      ? rows
      : rows.filter((u) => TAB_STATUS_MAP[activeTab].includes(u.status));

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
        <EmptyState icon="📋" title="No UCs found" message="No utilization certificates match the selected filter." />
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>UC No</th>
              <th>Grantee</th>
              <th>Grant Ref</th>
              <th>Period</th>
              <th className="num">Amount</th>
              <th>Submitted</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u.id}>
                <td><span className="mono">{u.ucNo}</span></td>
                <td>{u.grantee}</td>
                <td>{u.grantRef ?? "—"}</td>
                <td>{u.periodFrom} – {u.periodTo}</td>
                <td className="num">₹{(u.amount / 100).toLocaleString("en-IN")}</td>
                <td>{formatIndianDate(u.submittedDate)}</td>
                <td><StatusPill status={u.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
