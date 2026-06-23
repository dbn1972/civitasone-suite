"use client";

import { StatusPill } from "../../../_components/ds";
import { useSeededResource } from "@/lib/sync/resource";

type Opinion = {
  id: string;
  opinionNo: string;
  subject: string;
  requestedBy: string;
  advisorName?: string | null;
  status: string;
} & Record<string, unknown>;

export function OpinionsTable({ items, source = "api" }: { items: Opinion[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Opinion[]>(
    "legal.opinions",
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
        <h3>Opinion repository</h3>
        <div className="seg"><span className="on">All</span><span>Pending</span></div>
      </div>
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0", padding: "8px 16px 0" }}>
          {cacheNote}
        </p>
      ) : null}
      <table className="tbl">
        <thead>
          <tr>
            <th>Opinion</th>
            <th>Subject</th>
            <th>Sought by</th>
            <th>Author</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr key={item.id}>
              <td><span className="mono">{item.opinionNo}</span></td>
              <td>{item.subject}</td>
              <td>{item.requestedBy}</td>
              <td>{item.advisorName ?? "Law Dept"}</td>
              <td>
                {item.status === "issued" ? <span className="pill good">Issued</span>
                  : item.status === "draft" ? <span className="pill warn">Draft</span>
                  : item.status === "pending" ? <span className="pill info">Pending</span>
                  : <StatusPill status={item.status} />}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={5}><div className="empty-state"><div>📚</div><h4>No opinions yet</h4><p>Legal opinions will appear here once requested.</p></div></td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
