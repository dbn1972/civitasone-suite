"use client";

import { useState } from "react";

export default function DepreciationRunPage() {
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [depBook, setDepBook] = useState<"all" | "company" | "statutory">("all");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function runDepreciation(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/proxy/v1/asset/depreciation/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ period, depBook }),
      });
      if (!res.ok) throw new Error(await res.text());
      setMessage(`Depreciation run accepted for ${period} — GL journals posted via finance.gl.post.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Run failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <a className="back" href="/assets/dashboard">← Dashboard</a>
      <div className="ph" style={{ marginTop: 6 }}>
        <h1>Depreciation Run</h1>
        <div className="sub">Period-end depreciation — company (SLM) and statutory (WDV) books post to GL.</div>
      </div>
      <div className="card">
        <form onSubmit={runDepreciation} className="pad">
          <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start", marginBottom: 12 }}>
            <label className="l">Depreciation book</label>
            <select value={depBook} onChange={(e) => setDepBook(e.target.value as typeof depBook)} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--line)" }}>
              <option value="all">All books</option>
              <option value="company">Company (SLM → 5100)</option>
              <option value="statutory">Statutory (WDV → 5101)</option>
            </select>
          </div>
          <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start", marginBottom: 12 }}>
            <label className="l">Period (YYYY-MM)</label>
            <input value={period} onChange={(e) => setPeriod(e.target.value)} pattern="\d{4}-\d{2}" style={{ padding: 8, borderRadius: 8, border: "1px solid var(--line)" }} />
          </div>
          <button type="submit" className="btn primary" disabled={busy}>{busy ? "Running…" : "Run depreciation"}</button>
          {message ? <p style={{ marginTop: 12, fontSize: 13, color: "#047857" }}>{message}</p> : null}
        </form>
      </div>
    </>
  );
}
