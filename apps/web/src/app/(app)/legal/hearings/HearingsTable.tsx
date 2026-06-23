"use client";

import Link from "next/link";
import { useSeededResource } from "@/lib/sync/resource";

type Hearing = {
  id: string;
  caseId: string;
  caseNo: string;
  court: string;
  date: string;
  time?: string | null;
  purpose?: string | null;
  status: string;
} & Record<string, unknown>;

export function HearingsTable({ items, source = "api" }: { items: Hearing[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Hearing[]>(
    "legal.hearings",
    items,
    source,
    (d) => d.length === 0,
  );

  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <div className="card">
      <div className="card-h">
        <h3>Hearing schedule</h3>
        <div className="seg"><span className="on">This week</span><span>Today</span></div>
      </div>
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0", padding: "8px 16px 0" }}>
          {cacheNote}
        </p>
      ) : null}
      <table className="tbl">
        <thead>
          <tr>
            <th>Date &amp; time</th>
            <th>Case No.</th>
            <th>Court</th>
            <th>Purpose</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((item) => (
            <tr key={item.id}>
              <td>{item.date}{item.time ? ` · ${item.time}` : ""}</td>
              <td>
                <Link href={`/legal/cases/${item.caseId}`} className="lnk">
                  {item.caseNo}
                </Link>
              </td>
              <td>{item.court}</td>
              <td>{item.purpose ?? "—"}</td>
              <td>
                {item.status === "completed" ? <span className="pill good">Listed</span>
                  : item.status === "adjourned" ? <span className="pill warn">Adjourned</span>
                  : item.status === "cancelled" ? <span className="pill bad">Cancelled</span>
                  : <span className="pill info">Listed</span>}
              </td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr><td colSpan={5}><div className="empty-state"><div>🗓️</div><h4>No hearings scheduled</h4><p>Court hearings will appear here once added to cases.</p></div></td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
