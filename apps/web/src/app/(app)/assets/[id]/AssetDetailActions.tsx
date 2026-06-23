"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  assetId: string;
  barcode?: string | null;
  status: string;
};

export function AssetDetailActions({ assetId, barcode, status }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [tagCode, setTagCode] = useState(barcode ?? "");
  const [toLocation, setToLocation] = useState("");
  const [proceeds, setProceeds] = useState("");

  async function tagAsset() {
    if (!tagCode.trim()) return;
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/proxy/v1/asset/assets/${assetId}/barcode`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ barcode: tagCode.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      setMessage("Barcode tagged.");
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Tag failed");
    } finally {
      setBusy(false);
    }
  }

  async function scheduleAmc() {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/proxy/v1/asset/assets/${assetId}/maintenance`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          frequency: "annual",
          nextDue: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
          description: "AMC plan",
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setMessage("AMC plan scheduled.");
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "AMC failed");
    } finally {
      setBusy(false);
    }
  }

  async function transfer() {
    if (!toLocation.trim()) return;
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/proxy/v1/asset/assets/${assetId}/transfer`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fromLocation: "current",
          toLocation: toLocation.trim(),
          transferDate: new Date().toISOString().slice(0, 10),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setMessage("Asset transferred.");
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Transfer failed");
    } finally {
      setBusy(false);
    }
  }

  async function dispose() {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/proxy/v1/asset/assets/${assetId}/request-disposal`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          disposalDate: new Date().toISOString().slice(0, 10),
          disposalMethod: "sale",
          proceedsMinor: Math.round(Number(proceeds || "0") * 100),
          currency: "INR",
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setMessage("Disposal submitted for workflow approval.");
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Disposal failed");
    } finally {
      setBusy(false);
    }
  }

  function printQr() {
    const code = tagCode || barcode || assetId.slice(0, 8);
    const w = window.open("", "_blank", "width=400,height=300");
    if (!w) return;
    w.document.write(`<html><body style="font-family:monospace;text-align:center;padding:40px"><h2>${code}</h2><p>Asset tag — scan for verification</p></body></html>`);
    w.print();
  }

  if (status === "disposed" || status === "written_off") return null;

  return (
    <div className="card">
      <div className="card-h"><h3>Asset actions</h3></div>
      <div className="pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input value={tagCode} onChange={(e) => setTagCode(e.target.value)} placeholder="Barcode / QR code" style={{ flex: 1, minWidth: 180, padding: 8, border: "1px solid var(--line)", borderRadius: 8, fontSize: 13 }} />
          <button type="button" className="btn ghost" disabled={busy} onClick={() => void tagAsset()}>Tag</button>
          <button type="button" className="btn ghost" disabled={busy} onClick={printQr}>Print QR</button>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void scheduleAmc()}>Schedule AMC</button>
        </div>
        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <input value={toLocation} onChange={(e) => setToLocation(e.target.value)} placeholder="Transfer to location" style={{ width: "100%", padding: 8, marginBottom: 8, border: "1px solid var(--line)", borderRadius: 8, fontSize: 13 }} />
          <button type="button" className="btn ghost" disabled={busy} onClick={() => void transfer()}>Transfer</button>
        </div>
        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <input value={proceeds} onChange={(e) => setProceeds(e.target.value)} placeholder="Disposal proceeds (₹)" style={{ width: "100%", padding: 8, marginBottom: 8, border: "1px solid var(--line)", borderRadius: 8, fontSize: 13 }} />
          <button type="button" className="btn ghost" disabled={busy} onClick={() => void dispose()}>Request disposal</button>
        </div>
        {message ? <p style={{ fontSize: 13, color: "#047857", margin: 0 }}>{message}</p> : null}
      </div>
    </div>
  );
}
