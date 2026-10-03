"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button, PageHeader, StatusPill } from "../../../_components/ds";
import { formatMoney } from "@/lib/formatters";
import { scanFailureMessage, scanNetworkMessage } from "./scanErrors";

type ScanResult = {
  id: string;
  code: string;
  name: string;
  barcode: string;
  status: string;
  /** Paise (minor units) -- asset-service /scan returns Number(book_value), the same unit as the asset detail page. */
  bookValue: number;
};

export default function MobileScanPage() {
  const [barcode, setBarcode] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    barcodeInputRef.current?.focus();
  }, []);

  async function scan(e: React.FormEvent) {
    e.preventDefault();
    if (!barcode.trim()) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch(`/api/proxy/v1/asset/scan/${encodeURIComponent(barcode.trim())}`);
      if (!res.ok) {
        setError(scanFailureMessage(res.status).message);
        return;
      }
      setResult(await res.json() as ScanResult);
      // GAP-ASSETS-SCAN-05: ready for the next tag -- select the text so a
      // hardware scanner's next read replaces it.
      barcodeInputRef.current?.focus();
      barcodeInputRef.current?.select();
    } catch {
      setError(scanNetworkMessage());
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Asset Lookup"
        subtitle="Look up an asset by its tag — enter or paste the tag, or use a connected hardware scanner."
        back="/assets"
        backLabel="Assets"
        actions={<Link href="/assets/verification" className="btn ghost">Verification sessions</Link>}
      />
      <div className="card">
        <form onSubmit={scan} className="pad">
          <label htmlFor="scan-input" className="l">Asset tag / barcode</label>
          <input
            id="scan-input"
            ref={barcodeInputRef}
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            placeholder="Type or paste a barcode…"
            inputMode="text"
            style={{ width: "100%", padding: 14, fontSize: 18, borderRadius: 12, border: "2px solid var(--line)", margin: "6px 0 6px" }}
          />
          <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 12px" }}>
            Use a connected hardware scanner (it types into this field) or enter the tag manually. Live camera capture is not available in this build.
          </p>
          <Button type="submit" disabled={busy} style={{ width: "100%" }}>{busy ? "Looking up…" : "Lookup asset"}</Button>
        </form>
      </div>

      <div aria-live="polite" role="status">
        {error ? (
          <div role="alert" className="banner" style={{ background: "var(--panel)", color: "var(--bad)", border: "1px solid var(--bad)", padding: 12, borderRadius: 12, marginTop: 16, fontSize: 13 }}>{error}</div>
        ) : null}
        {result ? (
          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-h"><h3>{result.name}</h3></div>
            <div className="pad" style={{ fontSize: 14 }}>
              <p><strong>Code:</strong> {result.code}</p>
              <p><strong>Barcode:</strong> {result.barcode}</p>
              <p><strong>Status:</strong> <StatusPill status={result.status} /></p>
              <p><strong>Book value:</strong> {formatMoney(result.bookValue)}</p>
              <Link className="btn ghost" href={`/assets/${result.id}`} style={{ marginTop: 8, display: "inline-block" }}>Open asset</Link>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
