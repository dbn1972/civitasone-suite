"use client";

import { useMemo, useState } from "react";
import { Segmented, DataTable, StatusPill } from "../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";

type KeyRow = {
  id: string;
  keyName: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt?: string;
  expiresAt?: string;
  status: "active" | "expired" | "revoked";
} & Record<string, unknown>;

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
      <DataTable<KeyRow>
        columns={[
          {
            key: "keyName",
            label: "Name",
            render: (key) => (
              <>
                <div style={{ fontWeight: 500 }}>{key.keyName}</div>
                <div style={{ fontSize: 11, color: "#98a2b3" }}><span className="mono">{key.keyPrefix}****</span></div>
              </>
            ),
          },
          { key: "scopes", label: "Scope", render: (key) => (key.scopes.length > 0 ? key.scopes.join(", ") : "—") },
          { key: "lastUsedAt", label: "Last used", render: (key) => (key.lastUsedAt ? formatIndianDate(key.lastUsedAt) : "Never") },
          { key: "expiresAt", label: "Expires", render: (key) => (key.expiresAt ? formatIndianDate(key.expiresAt) : "—") },
          {
            key: "status",
            label: "Status",
            render: (key) =>
              key.status === "active" ? <span className="pill good">Active</span>
                : key.status === "revoked" ? <span className="pill bad">Revoked</span>
                : <StatusPill status="inactive" label="Expired" />,
          },
        ]}
        rows={rows}
        sortable
      />
    </div>
  );
}
