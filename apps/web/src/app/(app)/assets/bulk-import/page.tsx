"use client";

import { useState } from "react";

export default function BulkImportPage() {
  const [csv, setCsv] = useState("name,code,assetType,cost,orgUnit\nSample Laptop,LAP/001,it,45000,HQ");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const lines = csv.trim().split("\n").slice(1);
      const assets = lines.filter(Boolean).map((line) => {
        const [name, code, assetType, cost, orgUnit] = line.split(",").map((s) => s.trim());
        return {
          name,
          code,
          assetType: assetType || "fixed",
          acquisitionCostMinor: Math.round(Number(cost || "0") * 100),
          orgUnit: orgUnit || undefined,
        };
      });
      const res = await fetch("/api/proxy/v1/asset/bulk/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assets }),
      });
      if (!res.ok) throw new Error(await res.text());
      setMessage(`Bulk import accepted — ${assets.length} assets queued.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <a className="back" href="/assets">← Assets</a>
      <div className="ph" style={{ marginTop: 6 }}>
        <h1>Bulk Import</h1>
        <div className="sub">Mass asset load — CSV format: name,code,assetType,cost,orgUnit</div>
      </div>
      <div className="card">
        <form onSubmit={submit} className="pad">
          <textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            rows={12}
            style={{ width: "100%", fontFamily: "monospace", fontSize: 12, padding: 12, borderRadius: 8, border: "1px solid var(--line)" }}
          />
          <button type="submit" className="btn primary" disabled={busy} style={{ marginTop: 12 }}>{busy ? "Importing…" : "Import assets"}</button>
          {message ? <p style={{ marginTop: 12, fontSize: 13, color: "#047857" }}>{message}</p> : null}
        </form>
      </div>
    </>
  );
}
