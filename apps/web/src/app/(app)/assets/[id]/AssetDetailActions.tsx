"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog, useConfirmAction } from "../../../_components/ds";

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

  // Maker-checker: transfer changes custody/location of a government asset.
  const transferAction = useConfirmAction({
    onConfirm: async (reason) => {
      const res = await fetch(`/api/proxy/v1/asset/assets/${assetId}/transfer`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fromLocation: "current",
          toLocation: toLocation.trim(),
          transferDate: new Date().toISOString().slice(0, 10),
          reason,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setMessage("Asset transferred.");
      router.refresh();
    },
  });

  // Maker-checker: disposal is GFR-irreversible and posts proceeds to GL.
  const disposeAction = useConfirmAction({
    onConfirm: async (reason) => {
      const res = await fetch(`/api/proxy/v1/asset/assets/${assetId}/request-disposal`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          disposalDate: new Date().toISOString().slice(0, 10),
          disposalMethod: "sale",
          proceedsMinor: Math.round(Number(proceeds || "0") * 100),
          currency: "INR",
          reason,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setMessage("Disposal submitted for workflow approval.");
      router.refresh();
    },
  });

  function printQr() {
    const code = tagCode || barcode || assetId.slice(0, 8);
    const w = window.open("", "_blank", "width=400,height=300");
    if (!w) return;
    w.document.write(`<html><body style="font-family:monospace;text-align:center;padding:40px"><h2>${code}</h2><p>Asset tag — scan for verification</p></body></html>`);
    w.print();
  }

  if (status === "disposed" || status === "written_off") return null;

  const transferDisabled = busy || !toLocation.trim();

  return (
    <div className="card">
      <div className="card-h"><h3>Asset actions</h3></div>
      <div className="pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <label htmlFor="asset-tag-code" className="sr-only">Barcode / QR code</label>
          <input id="asset-tag-code" value={tagCode} onChange={(e) => setTagCode(e.target.value)} placeholder="Barcode / QR code" style={{ flex: 1, minWidth: 180, padding: 8, border: "1px solid var(--line)", borderRadius: 8, fontSize: 13 }} />
          <button type="button" className="btn ghost" disabled={busy} onClick={() => void tagAsset()}>Tag</button>
          <button type="button" className="btn ghost" disabled={busy} onClick={printQr}>Print QR</button>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void scheduleAmc()}>Schedule AMC</button>
        </div>
        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <label htmlFor="asset-transfer-loc" className="sr-only">Transfer to location</label>
          <input id="asset-transfer-loc" value={toLocation} onChange={(e) => setToLocation(e.target.value)} placeholder="Transfer to location" style={{ width: "100%", padding: 8, marginBottom: 8, border: "1px solid var(--line)", borderRadius: 8, fontSize: 13 }} />
          <button type="button" className="btn ghost" disabled={transferDisabled} onClick={transferAction.trigger}>Transfer</button>
        </div>
        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <label htmlFor="asset-proceeds" className="sr-only">Disposal proceeds in rupees</label>
          <input id="asset-proceeds" value={proceeds} onChange={(e) => setProceeds(e.target.value)} inputMode="decimal" placeholder="Disposal proceeds (₹)" style={{ width: "100%", padding: 8, marginBottom: 8, border: "1px solid var(--line)", borderRadius: 8, fontSize: 13 }} />
          <button type="button" className="btn danger" disabled={busy} onClick={disposeAction.trigger}>Request disposal</button>
        </div>
        {message ? <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", margin: 0 }}>{message}</p> : null}
      </div>

      <ConfirmDialog
        open={transferAction.open}
        title="Transfer this asset?"
        description={<>This reassigns custody of a government asset to <b>{toLocation || "the selected location"}</b> and is logged for audit. Provide a reason to proceed.</>}
        confirmLabel="Transfer asset"
        requireReason
        reasonLabel="Reason for transfer"
        busy={transferAction.busy}
        errorMessage={transferAction.error}
        onConfirm={transferAction.confirm}
        onCancel={transferAction.cancel}
      />

      <ConfirmDialog
        open={disposeAction.open}
        title="Request disposal of this asset?"
        description={<>Disposal is <b>GFR-irreversible</b>: it removes the asset from the live register, submits a write-off for approval and posts proceeds to the GL. This cannot be undone. Provide a reason to proceed.</>}
        confirmLabel="Submit disposal"
        danger
        requireReason
        reasonLabel="Reason for disposal"
        busy={disposeAction.busy}
        errorMessage={disposeAction.error}
        onConfirm={disposeAction.confirm}
        onCancel={disposeAction.cancel}
      />
    </div>
  );
}
