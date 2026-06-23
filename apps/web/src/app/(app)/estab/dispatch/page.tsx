"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader, StatusPill } from "../../../_components/ds";

type DispatchRow = {
  id: string;
  dispatchNo: string;
  toAddress: string;
  subject: string;
  mode: string;
  status: string;
  fileId?: string | null;
  dispatchedAt?: string | null;
};

export default function DispatchRegistryPage() {
  const [rows, setRows] = useState<DispatchRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/proxy/v1/estab/dispatch?limit=100");
      if (!res.ok) throw new Error(await res.text());
      const body = await res.json() as { data?: DispatchRow[] };
      setRows(body.data ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <PageHeader
        title="Outward Dispatch Register"
        subtitle="Track dispatches linked to eOffice files."
        back="/estab/list"
      />
      <div className="card">
        <div className="card-h"><h3>Dispatch register</h3></div>
        <table className="tbl">
          <thead>
            <tr><th>Dispatch No</th><th>To</th><th>Subject</th><th>Mode</th><th>Date</th><th>Status</th></tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ textAlign: "center", padding: 24 }}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: "center", padding: 24 }}>No dispatches yet</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td><span className="mono">{r.dispatchNo}</span></td>
                  <td>{r.toAddress}</td>
                  <td>{r.subject}</td>
                  <td>{r.mode}</td>
                  <td>{r.dispatchedAt?.slice(0, 10) ?? "—"}</td>
                  <td><StatusPill status={r.status} label={r.status} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
