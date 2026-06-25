"use client";

import { useMemo, useState } from "react";
import { Segmented } from "../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";

type KeyRow = {
  id: string;
  keyName: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt?: string;
  expiresAt?: string;
  status: "active" | "expired" | "revoked";
};

const FILTERS = ["All", "Active", "Expired", "Revoked"] as const;

export function APIKeysTable({ keys }: { keys: KeyRow[] }) {
  const [filter, setFilter] = useState<string>("All");

  const rows = useMemo(() => {
    if (filter === "All") return keys;
    return keys.filter((k) => k.status === filter.toLowerCase());
  }, [keys, filter]);

  return (
    <div className="card">
      <div className="card-h">
        <h3 id="api-keys-table-heading">API keys</h3>
        <div role="group" aria-label="Filter API keys by status"><Segmented options={[...FILTERS]} value={filter} onChange={setFilter} /></div>
      </div>
      <table className="tbl" aria-labelledby="api-keys-table-heading">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Scope</th>
            <th scope="col">Last used</th>
            <th scope="col">Expires</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((key) => (
            <tr key={key.id}>
              <td>
                <div style={{ fontWeight: 500 }}>{key.keyName}</div>
                <div style={{ fontSize: 11, color: "#98a2b3" }}><span className="mono">{key.keyPrefix}****</span></div>
              </td>
              <td>{key.scopes.length > 0 ? key.scopes.join(", ") : "—"}</td>
              <td>{key.lastUsedAt ? formatIndianDate(key.lastUsedAt) : "Never"}</td>
              <td>{key.expiresAt ? formatIndianDate(key.expiresAt) : "—"}</td>
              <td>
                {key.status === "active" ? <span className="pill good">Active</span>
                  : key.status === "revoked" ? <span className="pill bad">Revoked</span>
                  : <span className="pill mut">Expired</span>}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={5}><div className="empty-state"><div>🔑</div><h4>No API keys</h4><p>No keys match this filter.</p></div></td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
