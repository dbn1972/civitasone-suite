"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { ConfirmDialog, useConfirmAction } from "../../../_components/ds";
import { rupeesToMinorString } from "@/lib/money";
import { formatMoney } from "@/lib/formatters";

type Props = {
  assetId: string;
  barcode?: string | null;
  status: string;
};

/**
 * Non-negative rupees → paise-string, allowing blank or any zero-valued
 * amount as "no proceeds" (the lifecycle disposeBody / enterprise
 * request-disposal schemas accept proceedsMinor: 0 for a scrapped asset with
 * no sale value). rupeesToMinorString() itself rejects zero outright, which
 * is wrong here — but rather than pattern-matching a handful of zero
 * spellings ("0", "0.0", "0.00", which misses "00.00" etc. and spuriously
 * rejects them), parse the value directly: at most 2 significant fractional
 * digits (a 3rd+ decimal digit can't be represented exactly in paise, same
 * rule as rupeesToMinorString) and treat an all-zero result as "0" instead
 * of null. Returns null only for a non-empty, genuinely invalid amount.
 */
function proceedsToMinorString(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return "0";
  const match = /^(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) return null;
  const [, wholePart, fracPart = ""] = match;
  // Any non-zero digit beyond the 2nd decimal place is real precision loss —
  // reject it. Trailing zeros beyond 2 places (e.g. "0.000", "12.500") are
  // just imprecise formatting, not a rejection reason.
  if (/[1-9]/.test(fracPart.slice(2))) return null;
  const paise = `${fracPart}00`.slice(0, 2);
  const minor = BigInt(wholePart + paise);
  return minor.toString();
}

const inputStyle: React.CSSProperties = { width: "100%", padding: 8, marginBottom: 4, border: "1px solid var(--line)", borderRadius: 8, fontSize: 13 };

export function AssetDetailActions({ assetId, barcode, status }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [tagCode, setTagCode] = useState(barcode ?? "");
  const [toLocation, setToLocation] = useState("");
  const [proceeds, setProceeds] = useState("");

  // Direct dispose (lifecycle PATCH .../dispose — bypasses the eOffice
  // write-off workflow used by "Request disposal" below; admin-only in
  // practice, gated the same as every other mutation here by role at the
  // gateway).
  const [directDisposalDate, setDirectDisposalDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [directDisposalMethod, setDirectDisposalMethod] = useState("sale");
  const [directProceeds, setDirectProceeds] = useState("");
  const [directNotes, setDirectNotes] = useState("");
  const [directErrors, setDirectErrors] = useState<Record<string, string>>({});

  // Inter-org transfer (enterprise POST .../inter-org-transfer).
  const [fromOrg, setFromOrg] = useState("");
  const [toOrg, setToOrg] = useState("");
  const [interOrgDate, setInterOrgDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [interOrgNotes, setInterOrgNotes] = useState("");
  const [interOrgErrors, setInterOrgErrors] = useState<Record<string, string>>({});

  const directProceedsField = useId();
  const directProceedsErrId = useId();
  const fromOrgField = useId();
  const fromOrgErrId = useId();
  const toOrgField = useId();
  const toOrgErrId = useId();

  const directProceedsRef = useRef<HTMLInputElement>(null);
  const fromOrgRef = useRef<HTMLInputElement>(null);
  const toOrgRef = useRef<HTMLInputElement>(null);

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
      const proceedsMinor = proceedsToMinorString(proceeds) ?? "0";
      const res = await fetch(`/api/proxy/v1/asset/assets/${assetId}/request-disposal`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          disposalDate: new Date().toISOString().slice(0, 10),
          disposalMethod: "sale",
          proceedsMinor: Number(proceedsMinor),
          currency: "INR",
          reason,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setMessage("Disposal submitted for workflow approval.");
      router.refresh();
    },
  });

  // Direct dispose bypasses the eOffice write-off workflow entirely — GFR-irreversible.
  const directDisposeAction = useConfirmAction({
    onConfirm: async () => {
      const proceedsMinor = proceedsToMinorString(directProceeds) ?? "0";
      const res = await fetch(`/api/proxy/v1/asset/assets/${assetId}/dispose`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          disposalDate: directDisposalDate,
          disposalMethod: directDisposalMethod,
          proceedsMinor: Number(proceedsMinor),
          currency: "INR",
          ...(directNotes.trim() ? { notes: directNotes.trim() } : {}),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setMessage("Direct disposal submitted (workflow bypassed).");
      router.refresh();
    },
  });

  const interOrgTransferAction = useConfirmAction({
    onConfirm: async () => {
      const res = await fetch(`/api/proxy/v1/asset/assets/${assetId}/inter-org-transfer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fromOrg: fromOrg.trim(),
          toOrg: toOrg.trim(),
          transferDate: interOrgDate,
          ...(interOrgNotes.trim() ? { notes: interOrgNotes.trim() } : {}),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setMessage("Inter-organisation transfer submitted.");
      router.refresh();
    },
  });

  function validateDirectDispose(): boolean {
    const next: Record<string, string> = {};
    if (directProceeds.trim() && proceedsToMinorString(directProceeds) === null) {
      next.proceeds = "Enter a valid non-negative proceeds amount (₹) with at most 2 decimals, or leave blank.";
    }
    setDirectErrors(next);
    if (next.proceeds) { directProceedsRef.current?.focus(); return false; }
    return true;
  }

  function validateInterOrgTransfer(): boolean {
    const next: Record<string, string> = {};
    if (!fromOrg.trim()) next.fromOrg = "Enter the originating org unit.";
    if (!toOrg.trim()) next.toOrg = "Enter the receiving org unit.";
    setInterOrgErrors(next);
    if (next.fromOrg) { fromOrgRef.current?.focus(); return false; }
    if (next.toOrg) { toOrgRef.current?.focus(); return false; }
    return true;
  }

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
          <input id="asset-transfer-loc" value={toLocation} onChange={(e) => setToLocation(e.target.value)} placeholder="Transfer to location" style={inputStyle} />
          <button type="button" className="btn ghost" disabled={transferDisabled} onClick={transferAction.trigger}>Transfer</button>
        </div>
        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <label htmlFor="asset-proceeds" className="sr-only">Disposal proceeds in rupees</label>
          <input id="asset-proceeds" value={proceeds} onChange={(e) => setProceeds(e.target.value)} inputMode="decimal" placeholder="Disposal proceeds (₹)" style={inputStyle} />
          <button type="button" className="btn danger" disabled={busy} onClick={disposeAction.trigger}>Request disposal</button>
        </div>

        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Direct disposal (bypasses eOffice workflow)</div>
          <label htmlFor="asset-direct-dispose-date" className="sr-only">Disposal date</label>
          <input
            id="asset-direct-dispose-date"
            type="date"
            value={directDisposalDate}
            onChange={(e) => setDirectDisposalDate(e.target.value)}
            aria-required="true"
            style={inputStyle}
          />
          <label htmlFor="asset-direct-dispose-method" className="sr-only">Disposal method</label>
          <select
            id="asset-direct-dispose-method"
            value={directDisposalMethod}
            onChange={(e) => setDirectDisposalMethod(e.target.value)}
            aria-required="true"
            style={inputStyle}
          >
            <option value="sale">Sale</option>
            <option value="scrap">Scrap</option>
            <option value="auction">Auction</option>
            <option value="donation">Donation</option>
            <option value="write_off">Write-off</option>
          </select>
          <label htmlFor={directProceedsField} className="sr-only">Disposal proceeds in rupees (optional)</label>
          <input
            id={directProceedsField}
            ref={directProceedsRef}
            value={directProceeds}
            onChange={(e) => setDirectProceeds(e.target.value)}
            inputMode="decimal"
            placeholder="Proceeds (₹), leave blank for none"
            aria-invalid={!!directErrors.proceeds || undefined}
            aria-describedby={directErrors.proceeds ? directProceedsErrId : undefined}
            style={inputStyle}
          />
          {directErrors.proceeds && <p id={directProceedsErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: "0 0 4px" }}>{directErrors.proceeds}</p>}
          <label htmlFor="asset-direct-dispose-notes" className="sr-only">Disposal notes (optional)</label>
          <textarea
            id="asset-direct-dispose-notes"
            value={directNotes}
            onChange={(e) => setDirectNotes(e.target.value)}
            placeholder="Notes (optional)"
            rows={2}
            style={{ ...inputStyle, minHeight: 50 }}
          />
          <button
            type="button"
            className="btn danger"
            disabled={busy}
            onClick={() => {
              if (!validateDirectDispose()) return;
              directDisposeAction.trigger();
            }}
          >
            Direct dispose
          </button>
        </div>

        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Inter-organisation transfer</div>
          <label htmlFor={fromOrgField} className="sr-only">From org unit</label>
          <input
            id={fromOrgField}
            ref={fromOrgRef}
            value={fromOrg}
            onChange={(e) => setFromOrg(e.target.value)}
            placeholder="From org unit"
            aria-required="true"
            aria-invalid={!!interOrgErrors.fromOrg || undefined}
            aria-describedby={interOrgErrors.fromOrg ? fromOrgErrId : undefined}
            style={inputStyle}
          />
          {interOrgErrors.fromOrg && <p id={fromOrgErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: "0 0 4px" }}>{interOrgErrors.fromOrg}</p>}
          <label htmlFor={toOrgField} className="sr-only">To org unit</label>
          <input
            id={toOrgField}
            ref={toOrgRef}
            value={toOrg}
            onChange={(e) => setToOrg(e.target.value)}
            placeholder="To org unit"
            aria-required="true"
            aria-invalid={!!interOrgErrors.toOrg || undefined}
            aria-describedby={interOrgErrors.toOrg ? toOrgErrId : undefined}
            style={inputStyle}
          />
          {interOrgErrors.toOrg && <p id={toOrgErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: "0 0 4px" }}>{interOrgErrors.toOrg}</p>}
          <label htmlFor="asset-inter-org-date" className="sr-only">Transfer date</label>
          <input
            id="asset-inter-org-date"
            type="date"
            value={interOrgDate}
            onChange={(e) => setInterOrgDate(e.target.value)}
            aria-required="true"
            style={inputStyle}
          />
          <label htmlFor="asset-inter-org-notes" className="sr-only">Notes (optional)</label>
          <textarea
            id="asset-inter-org-notes"
            value={interOrgNotes}
            onChange={(e) => setInterOrgNotes(e.target.value)}
            placeholder="Notes (optional)"
            rows={2}
            style={{ ...inputStyle, minHeight: 50 }}
          />
          <button
            type="button"
            className="btn ghost"
            disabled={busy}
            onClick={() => {
              if (!validateInterOrgTransfer()) return;
              interOrgTransferAction.trigger();
            }}
          >
            Inter-org transfer
          </button>
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

      <ConfirmDialog
        open={directDisposeAction.open}
        title="Directly dispose this asset?"
        description={
          <>
            This <b>bypasses the eOffice write-off approval workflow</b> and immediately marks the asset disposed,
            posting <b>{formatMoney(Number(proceedsToMinorString(directProceeds) ?? "0"))}</b> proceeds. This is{" "}
            <b>GFR-irreversible</b> and cannot be undone from this screen.
          </>
        }
        confirmLabel="Dispose asset"
        danger
        busy={directDisposeAction.busy}
        errorMessage={directDisposeAction.error}
        onConfirm={() => directDisposeAction.confirm()}
        onCancel={directDisposeAction.cancel}
      />

      <ConfirmDialog
        open={interOrgTransferAction.open}
        title="Transfer this asset to another organisation?"
        description={
          <>
            Reassigns this asset from <b>{fromOrg || "the source org"}</b> to <b>{toOrg || "the destination org"}</b>{" "}
            and updates its location on the register. This is logged for audit.
          </>
        }
        confirmLabel="Transfer to organisation"
        busy={interOrgTransferAction.busy}
        errorMessage={interOrgTransferAction.error}
        onConfirm={() => interOrgTransferAction.confirm()}
        onCancel={interOrgTransferAction.cancel}
      />
    </div>
  );
}
