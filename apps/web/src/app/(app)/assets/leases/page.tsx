"use client";

import { useEffect, useState } from "react";

type Lease = {
  id: string;
  leaseNo: string;
  lessorName: string;
  rouCostMinor: number | string;
  liabilityMinor: number | string;
  leaseStart: string;
  leaseEnd: string;
  assetId?: string | null;
  status: string;
};

export default function LeasesPage() {
  const [rows, setRows] = useState<Lease[]>([]);
  const [form, setForm] = useState({ leaseNo: "", lessorName: "", rouCost: "", liability: "", leaseStart: "", leaseEnd: "" });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch("/api/proxy/v1/asset/leases");
    if (!res.ok) return;
    const body = await res.json() as { data: Lease[] };
    setRows(body.data ?? []);
  }

  useEffect(() => { void load(); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/proxy/v1/asset/leases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          leaseNo: form.leaseNo,
          lessorName: form.lessorName,
          rouCostMinor: Math.round(Number(form.rouCost || "0") * 100),
          liabilityMinor: Math.round(Number(form.liability || "0") * 100),
          leaseStart: form.leaseStart,
          leaseEnd: form.leaseEnd,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setMessage("IFRS 16 lease registered with ROU asset.");
      setForm({ leaseNo: "", lessorName: "", rouCost: "", liability: "", leaseStart: "", leaseEnd: "" });
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Register failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <a className="back" href="/assets">← Assets</a>
      <div className="ph" style={{ marginTop: 6 }}>
        <h1>IFRS 16 Leases</h1>
        <div className="sub">Right-of-use assets and lease liability tracking.</div>
      </div>
      {message ? <div className="banner" style={{ background: "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{message}</div> : null}
      <div className="card" style={{ marginBottom: 16 }}>
        <form onSubmit={submit} className="pad">
          <div className="fields">
            <input required placeholder="Lease no." value={form.leaseNo} onChange={(e) => setForm({ ...form, leaseNo: e.target.value })} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--line)" }} />
            <input required placeholder="Lessor" value={form.lessorName} onChange={(e) => setForm({ ...form, lessorName: e.target.value })} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--line)" }} />
            <input required placeholder="ROU cost (₹)" value={form.rouCost} onChange={(e) => setForm({ ...form, rouCost: e.target.value })} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--line)" }} />
            <input required placeholder="Liability (₹)" value={form.liability} onChange={(e) => setForm({ ...form, liability: e.target.value })} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--line)" }} />
            <input required type="date" value={form.leaseStart} onChange={(e) => setForm({ ...form, leaseStart: e.target.value })} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--line)" }} />
            <input required type="date" value={form.leaseEnd} onChange={(e) => setForm({ ...form, leaseEnd: e.target.value })} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--line)" }} />
          </div>
          <button type="submit" className="btn primary" disabled={busy} style={{ marginTop: 12 }}>Register lease</button>
        </form>
      </div>
      <div className="card">
        <div className="card-h"><h3>Active leases</h3></div>
        <div className="pad">
          {rows.length === 0 ? <p style={{ fontSize: 13, color: "var(--muted)" }}>No leases yet.</p> : (
            <table className="tbl">
              <thead><tr><th>Lease</th><th>Lessor</th><th>ROU</th><th>Term</th><th>Asset</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.leaseNo}</td>
                    <td>{r.lessorName}</td>
                    <td>₹{(Number(r.rouCostMinor) / 100).toLocaleString("en-IN")}</td>
                    <td>{r.leaseStart} → {r.leaseEnd}</td>
                    <td>{r.assetId ? <a href={`/assets/${r.assetId}`}>View</a> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
