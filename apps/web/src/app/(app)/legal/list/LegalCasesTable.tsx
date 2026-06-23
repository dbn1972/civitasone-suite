"use client";

import Link from "next/link";
import { StatusPill } from "../../../_components/ds";
import { useSeededResource } from "@/lib/sync/resource";

type LegalCase = {
  id: string;
  caseNo: string;
  title: string;
  court: string;
  type: string;
  advocateName?: string | null;
  status: string;
} & Record<string, unknown>;

export function LegalCasesTable({ items, source = "api" }: { items: LegalCase[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<LegalCase[]>(
    "legal.cases",
    items,
    source,
    (d) => d.length === 0,
  );

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <div className="card">
      <div className="card-h">
        <h3>Court cases</h3>
        <div className="seg"><span className="on">All</span><span>High Court</span><span>Adverse risk</span></div>
      </div>
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0", padding: "8px 16px 0" }}>
          {cacheNote}
        </p>
      ) : null}
      <table className="tbl">
        <thead>
          <tr>
            <th>Case no.</th>
            <th>Title</th>
            <th>Court</th>
            <th>Subject</th>
            <th>Counsel</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr key={item.id} className="clickable">
              <td>
                <Link href={`/legal/cases/${item.id}`}>
                  <span className="mono">{item.caseNo}</span>
                </Link>
              </td>
              <td>{item.title}</td>
              <td>{item.court}</td>
              <td>{item.type}</td>
              <td>{item.advocateName ?? "—"}</td>
              <td>
                {item.status === "active" ? <span className="pill warn">Pending</span>
                  : item.status === "disposed" ? <span className="pill mut">Disposed</span>
                  : item.status === "stayed" ? <span className="pill info">Stayed</span>
                  : item.status === "settled" ? <span className="pill good">Settled</span>
                  : <StatusPill status={item.status} />}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={6}><div className="empty-state"><div>📁</div><h4>No cases yet</h4><p>Legal cases will appear here once filed.</p></div></td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
