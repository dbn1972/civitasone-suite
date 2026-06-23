"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Verification = { id: string; status: string; verificationDate?: string; location?: string };

export default function AssetVerificationPage() {
  const [rows, setRows] = useState<Verification[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/proxy/v1/asset/verifications?limit=50");
      if (!res.ok) throw new Error(await res.text());
      const body = await res.json() as { data?: Verification[] };
      setRows(body.data ?? []);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function createSession() {
    setMessage("");
    try {
      const res = await fetch("/api/proxy/v1/asset/verifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          verificationDate: new Date().toISOString().slice(0, 10),
          location: "HQ Block",
          notes: "Annual physical verification",
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setMessage("Verification session created.");
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Create failed");
    }
  }

  return (
    <>
      <a className="back" href="/assets/dashboard">← Dashboard</a>
      <div className="ph" style={{ marginTop: 6 }}>
        <h1>Physical Verification</h1>
        <div className="sub">Barcode-driven audit — GFR-aligned write-off before disposal.</div>
        <div className="ph-act">
          <button type="button" className="btn primary" onClick={() => void createSession()}>+ New verification</button>
        </div>
      </div>
      {message ? <div className="banner" style={{ background: "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{message}</div> : null}
      <div className="card">
        <table className="tbl">
          <thead><tr><th>Session</th><th>Date</th><th>Location</th><th>Status</th></tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} style={{ textAlign: "center", padding: 24 }}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={4} style={{ textAlign: "center", padding: 24 }}>No verification sessions</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/assets/verification/${r.id}`} className="mono">{r.id.slice(0, 8)}</Link></td>
                  <td>{r.verificationDate?.slice(0, 10) ?? "—"}</td>
                  <td>{r.location ?? "—"}</td>
                  <td>{r.status}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
