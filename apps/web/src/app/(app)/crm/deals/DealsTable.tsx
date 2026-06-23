"use client";

import Link from "next/link";
import { StatusPill, EmptyState } from "../../../_components/ds";
import { useSeededResource } from "@/lib/sync/resource";

type Deal = {
  id: string;
  dealName: string;
  contactName?: string | null;
  amount: number;
  stage: string;
  status: string;
  owner: string;
} & Record<string, unknown>;

function fmtAmount(paise: number): string {
  const crore = paise / 10_000_000;
  return crore >= 1 ? `₹${crore.toFixed(1)} Cr` : `₹${(paise / 100).toLocaleString("en-IN")}`;
}

export function DealsTable({ deals, source = "api" }: { deals: Deal[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Deal[]>(
    "crm.deals",
    deals,
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
        <h3>Deals</h3>
        <div className="seg"><span className="on">All</span><span>Mine</span><span>Recent</span></div>
      </div>
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0", padding: "8px 16px 0" }}>
          {cacheNote}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState icon="🎯" title="No deals found" message="Start adding deals to track your pipeline." />
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>Deal #</th>
              <th>Account</th>
              <th>Value</th>
              <th>Stage</th>
              <th>Owner</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} className="clickable">
                <td><Link href={`/crm/deals/${d.id}`}>{d.dealName}</Link></td>
                <td>{d.contactName ?? "—"}</td>
                <td className="num">{fmtAmount(d.amount)}</td>
                <td><StatusPill status={d.stage} label={d.stage.replace(/_/g, " ")} /></td>
                <td>{d.owner}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
