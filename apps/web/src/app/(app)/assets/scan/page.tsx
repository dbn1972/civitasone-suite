"use client";

import { useState } from "react";
import { PageHeader } from "../../../_components/ds";
import { formatMoney } from "@/lib/formatters";

type ScanResult = {
  id: string;
  code: string;
  name: string;
  barcode: string;
  status: string;
  bookValue: number;
};

export default function MobileScanPage() {
  const [barcode, setBarcode] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function scan(e: React.FormEvent) {
    e.preventDefault();
    if (!barcode.trim()) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch(`/api/proxy/v1/asset/scan/${encodeURIComponent(barcode.trim())}`);
      if (!res.ok) throw new Error("Asset not found");
      setResult(await res.json() as ScanResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Barcode Scan"
        subtitle="Field verification — enter or paste an asset tag to look it up."
        back="/assets"
        backLabel="Assets"
      />
      <div className="card">
        <form onSubmit={scan} className="pad">
          <label htmlFor="scan-input" className="l">Asset tag / barcode</label>
          <input
            id="scan-input"
            autoFocus
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            placeholder="Type or paste a barcode…"
            inputMode="text"
            style={{ width: "100%", padding: 14, fontSize: 18, borderRadius: 12, border: "2px solid var(--line)", margin: "6px 0 6px" }}
          />
          <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 12px" }}>
            Use a connected hardware scanner (it types into this field) or enter the tag manually. Live camera capture is not available in this build.
          </p>
          <button type="submit" className="btn primary" disabled={busy} style={{ width: "100%" }}>{busy ? "Looking up…" : "Lookup asset"}</button>
        </form>
      </div>

      <div aria-live="polite" role="status">
        {error ? (
          <div className="banner" style={{ background: "#fef2f2", padding: 12, borderRadius: 12, marginTop: 16, fontSize: 13 }}>{error}</div>
        ) : null}
        {result ? (
          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-h"><h3>{result.name}</h3></div>
            <div className="pad" style={{ fontSize: 14 }}>
              <p><strong>Code:</strong> {result.code}</p>
              <p><strong>Barcode:</strong> {result.barcode}</p>
              <p><strong>Status:</strong> {result.status}</p>
              <p><strong>Book value:</strong> {formatMoney(result.bookValue)}</p>
              <a className="btn ghost" href={`/assets/${result.id}`} style={{ marginTop: 8, display: "inline-block" }}>Open asset</a>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
