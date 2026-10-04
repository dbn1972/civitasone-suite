"use client";

import { userFacingErrorFromResponse } from "@/lib/api/userFacingFromResponse";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { Button, ConfirmDialog, useConfirmAction } from "../../../_components/ds";
import { errorMessageFromResponse } from "@/lib/api/browserClient";
import { formatMoney, todayIST, addDaysIST } from "@/lib/formatters";
import { canWriteAssets } from "@/lib/auth/workRoles";
import { assetActionScope } from "@/lib/assetLifecycle";
import { isRealCalendarDate } from "@/lib/calendarDate";
import { createQrSvg } from "@/lib/qr";

type Props = {
  assetId: string;
  barcode?: string | null;
  status: string;
  /**
   * GAP-ASSETS-DETAIL-02: session roles from the server page. Only roles the
   * asset-service admits on its mutation routes see the action card at all;
   * the service remains authoritative (a 403 still surfaces in the dialog).
   */
  roles: readonly string[];
};

/**
 * GAP-ASSETS-DETAIL-03: a barcode is printed into a popup and scanned back, so
 * keep it to a plain code alphabet. Mirrors (more strictly) the asset-service
 * tagBarcodeBody, which rejects HTML-special characters outright.
 */
export const BARCODE_RE = /^[A-Za-z0-9\-_/.]{1,128}$/;

/**
 * GAP-ASSETS-DETAIL-03: open a print window for the asset tag WITHOUT ever
 * writing user/server text as HTML. The code is set via textContent, so a
 * stored barcode such as `<img src=x onerror=...>` prints as literal text.
 */
export function printAssetTag(code: string): void {
  const w = window.open("", "_blank", "width=400,height=300");
  if (!w) return;
  try { w.opener = null; } catch { /* some browsers make opener read-only */ }
  const doc = w.document;
  doc.title = "Asset tag";
  const body = doc.body ?? doc.appendChild(doc.createElement("body"));
  body.style.fontFamily = "monospace";
  body.style.textAlign = "center";
  body.style.padding = "40px";
  const h2 = doc.createElement("h2");
  h2.textContent = code;
  const p = doc.createElement("p");
  p.textContent = "Asset tag \u2014 scan the code for verification";
  // A real QR of the code (integers-only path, see lib/qr.ts). If encoding fails the printed code text still works.
  try { body.appendChild(createQrSvg(doc, code)); } catch { /* text-only tag */ }
  body.appendChild(h2);
  body.appendChild(p);
  w.focus();
  w.print();
}

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

/** Disposal methods the lifecycle / enterprise routes accept. */
const DISPOSAL_METHODS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "sale", label: "Sale" },
  { value: "scrap", label: "Scrap" },
  { value: "auction", label: "Auction" },
  { value: "donation", label: "Donation" },
  { value: "write_off", label: "Write-off" },
];

/**
 * GAP-ASSETS-DETAIL-06: the services take proceedsMinor as a JSON number, which
 * is exact only up to 2^53. Convert a validated paise string to a number only
 * when that is lossless; null means "too large to send safely".
 */
export function safeProceedsNumber(minor: string): number | null {
  const n = Number(minor);
  return Number.isSafeInteger(n) && BigInt(n).toString() === minor ? n : null;
}

/** Frequencies the maintenance plan accepts (service stores a short string). */
const AMC_FREQUENCIES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "half_yearly", label: "Half-yearly" },
  { value: "annual", label: "Annual" },
];

const inputStyle: React.CSSProperties = { width: "100%", padding: 8, marginBottom: 4, border: "1px solid var(--line)", borderRadius: 8, fontSize: 13 };

export function AssetDetailActions({ assetId, barcode, status, roles }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [tagCode, setTagCode] = useState(barcode ?? "");
  const [tagError, setTagError] = useState("");
  const [toLocation, setToLocation] = useState("");
  const [proceeds, setProceeds] = useState("");
  const [disposalMethod, setDisposalMethod] = useState("sale");
  const [requestErrors, setRequestErrors] = useState<Record<string, string>>({});
  // GAP-ASSETS-DETAIL-04: AMC is parameterised and confirmed, not fired from the click.
  const [amcFrequency, setAmcFrequency] = useState("annual");
  const [amcNextDue, setAmcNextDue] = useState(() => addDaysIST(todayIST(), 365));
  const [amcDescription, setAmcDescription] = useState("AMC plan");
  const [amcError, setAmcError] = useState("");

  // Direct dispose (lifecycle PATCH .../dispose — bypasses the eOffice
  // write-off workflow used by "Request disposal" below). The asset-service
  // consumer still refuses it unless an approved committee write-off exists
  // (GFR Rule 173), and the action card is only rendered for ASSET_WRITE_ROLES.
  const [directDisposalDate, setDirectDisposalDate] = useState(() => todayIST());
  const [directDisposalMethod, setDirectDisposalMethod] = useState("sale");
  const [directProceeds, setDirectProceeds] = useState("");
  const [directNotes, setDirectNotes] = useState("");
  const [directErrors, setDirectErrors] = useState<Record<string, string>>({});

  // Inter-org transfer (enterprise POST .../inter-org-transfer).
  const [fromOrg, setFromOrg] = useState("");
  const [toOrg, setToOrg] = useState("");
  const [interOrgDate, setInterOrgDate] = useState(() => todayIST());
  const [interOrgNotes, setInterOrgNotes] = useState("");
  const [interOrgErrors, setInterOrgErrors] = useState<Record<string, string>>({});

  const directProceedsField = useId();
  const directProceedsErrId = useId();
  const fromOrgField = useId();
  const fromOrgErrId = useId();
  const toOrgField = useId();
  const toOrgErrId = useId();

  const directProceedsRef = useRef<HTMLInputElement>(null);
  const requestProceedsRef = useRef<HTMLInputElement>(null);
  const fromOrgRef = useRef<HTMLInputElement>(null);
  const toOrgRef = useRef<HTMLInputElement>(null);

  async function tagAsset() {
    if (!tagCode.trim()) return;
    if (!BARCODE_RE.test(tagCode.trim())) {
      setTagError("Use letters, digits and - _ / . only (max 128 characters).");
      return;
    }
    setTagError("");
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/proxy/v1/asset/assets/${assetId}/barcode`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ barcode: tagCode.trim() }),
      });
      if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
      setMessage("Barcode tagged.");
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Tag failed");
    } finally {
      setBusy(false);
    }
  }

  const amcAction = useConfirmAction({
    onConfirm: async () => {
      const res = await fetch(`/api/proxy/v1/asset/assets/${assetId}/maintenance`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          frequency: amcFrequency,
          nextDue: amcNextDue,
          description: amcDescription.trim() || "AMC plan",
        }),
      });
      if (!res.ok) throw new Error(await errorMessageFromResponse(res, "save", "AMC plan"));
      setMessage("AMC plan scheduled.");
      router.refresh();
    },
  });

  function openAmcDialog() {
    if (!isRealCalendarDate(amcNextDue) || amcNextDue < todayIST()) {
      setAmcError("Choose a first due date that is today or later.");
      return;
    }
    setAmcError("");
    amcAction.trigger();
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
          transferDate: todayIST(),
          reason,
        }),
      });
      if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
      setMessage("Asset transferred.");
      router.refresh();
    },
  });

  // Maker-checker: disposal is GFR-irreversible and posts proceeds to GL.
  const disposeAction = useConfirmAction({
    onConfirm: async (reason) => {
      const proceedsMinor = safeProceedsNumber(proceedsToMinorString(proceeds) ?? "0");
      if (proceedsMinor === null) throw new Error("The proceeds amount is too large to submit.");
      const res = await fetch(`/api/proxy/v1/asset/assets/${assetId}/request-disposal`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          disposalDate: todayIST(),
          disposalMethod,
          proceedsMinor,
          currency: "INR",
          // asset-service names this field `notes`; a `reason` key is silently dropped.
          notes: reason,
        }),
      });
      if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
      setMessage("Disposal submitted for workflow approval.");
      router.refresh();
    },
  });

  // Direct dispose bypasses the eOffice write-off workflow entirely — GFR-irreversible.
  // GAP-ASSETS-DETAIL-02: the reason is mandatory and travels as the disposal
  // record's notes (the lifecycle disposeBody has no separate reason field).
  const directDisposeAction = useConfirmAction({
    onConfirm: async (reason) => {
      const proceedsMinor = safeProceedsNumber(proceedsToMinorString(directProceeds) ?? "0");
      if (proceedsMinor === null) throw new Error("The proceeds amount is too large to submit.");
      const why = (reason ?? "").trim();
      const extra = directNotes.trim();
      const notes = extra ? `${why}\n\n${extra}` : why;
      const res = await fetch(`/api/proxy/v1/asset/assets/${assetId}/dispose`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          disposalDate: directDisposalDate,
          disposalMethod: directDisposalMethod,
          proceedsMinor,
          currency: "INR",
          notes,
        }),
      });
      if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
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
      if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
      setMessage("Inter-organisation transfer submitted.");
      router.refresh();
    },
  });

  function validateRequestDisposal(): boolean {
    const next: Record<string, string> = {};
    const minor = proceedsToMinorString(proceeds);
    if (minor === null) next.proceeds = "Enter a valid non-negative proceeds amount (₹) with at most 2 decimals, or leave blank.";
    else if (safeProceedsNumber(minor) === null) next.proceeds = "That amount is too large to submit.";
    setRequestErrors(next);
    if (next.proceeds) { requestProceedsRef.current?.focus(); return false; }
    return true;
  }

  function validateDirectDispose(): boolean {
    const next: Record<string, string> = {};
    const directMinor = proceedsToMinorString(directProceeds);
    if (directMinor === null) {
      next.proceeds = "Enter a valid non-negative proceeds amount (₹) with at most 2 decimals, or leave blank.";
    } else if (safeProceedsNumber(directMinor) === null) {
      next.proceeds = "That amount is too large to submit.";
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

  function printTag() {
    printAssetTag(tagCode.trim() || barcode || assetId.slice(0, 8));
  }

  // GAP-ASSETS-DETAIL-05: the page and this card share assetActionScope().
  const scope = assetActionScope(status);
  if (scope === "none") return null;
  if (!canWriteAssets(roles)) return null;

  const transferDisabled = busy || !toLocation.trim();

  return (
    <div className="card">
      <div className="card-h"><h3>Asset actions</h3></div>
      <div className="pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <label htmlFor="asset-tag-code" className="sr-only">Barcode / QR code</label>
          <input
            id="asset-tag-code"
            value={tagCode}
            onChange={(e) => { setTagCode(e.target.value); setTagError(""); }}
            placeholder="Barcode / QR code"
            maxLength={128}
            aria-invalid={!!tagError || undefined}
            aria-describedby={tagError ? "asset-tag-code-err" : undefined}
            style={{ flex: 1, minWidth: 180, padding: 8, border: "1px solid var(--line)", borderRadius: 8, fontSize: 13 }}
          />
          <Button type="button" variant="ghost" disabled={busy} onClick={() => void tagAsset()}>Tag</Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={printTag}>Print tag</Button>
        </div>
        {tagError ? <p id="asset-tag-code-err" role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{tagError}</p> : null}
        {scope === "tag-only" ? (
          <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>
            This asset is condemned and awaiting auction, so transfer and disposal are handled in the condemnation workflow.
          </p>
        ) : null}
        {scope === "full" ? (<>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button type="button" disabled={busy} onClick={openAmcDialog}>Schedule AMC</Button>
        </div>
        {amcError ? <p role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{amcError}</p> : null}
        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <label htmlFor="asset-transfer-loc" className="sr-only">Transfer to location</label>
          <input id="asset-transfer-loc" value={toLocation} onChange={(e) => setToLocation(e.target.value)} placeholder="Transfer to location" style={inputStyle} />
          <Button type="button" variant="ghost" disabled={transferDisabled} onClick={transferAction.trigger}>Transfer</Button>
        </div>
        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <label htmlFor="asset-proceeds" className="sr-only">Disposal proceeds in rupees</label>
          <label htmlFor="asset-request-method" className="sr-only">Disposal method</label>
          <select id="asset-request-method" value={disposalMethod} onChange={(e) => setDisposalMethod(e.target.value)} style={inputStyle}>
            {DISPOSAL_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <input
            id="asset-proceeds"
            ref={requestProceedsRef}
            value={proceeds}
            onChange={(e) => setProceeds(e.target.value)}
            inputMode="decimal"
            placeholder="Disposal proceeds (₹), blank for none"
            aria-invalid={!!requestErrors.proceeds || undefined}
            aria-describedby={requestErrors.proceeds ? "asset-proceeds-err" : undefined}
            style={inputStyle}
          />
          {requestErrors.proceeds && <p id="asset-proceeds-err" role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: "0 0 4px" }}>{requestErrors.proceeds}</p>}
          <Button type="button" variant="danger" disabled={busy} onClick={() => { if (validateRequestDisposal()) disposeAction.trigger(); }}>Request disposal</Button>
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
            {DISPOSAL_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
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
          <Button
            type="button"
            variant="danger"
            disabled={busy}
            onClick={() => {
              if (!validateDirectDispose()) return;
              directDisposeAction.trigger();
            }}
          >
            Direct dispose
          </Button>
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
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              if (!validateInterOrgTransfer()) return;
              interOrgTransferAction.trigger();
            }}
          >
            Inter-org transfer
          </Button>
        </div>

        </>) : null}

        {message ? <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--good)", margin: 0 }}>{message}</p> : null}
      </div>

      <ConfirmDialog
        open={amcAction.open}
        title="Schedule an AMC plan?"
        description={<>This creates a recurring maintenance schedule for the asset. Check the details below.</>}
        confirmLabel="Schedule AMC"
        busy={amcAction.busy}
        errorMessage={amcAction.error}
        onConfirm={() => amcAction.confirm()}
        onCancel={amcAction.cancel}
      >
        <div style={{ display: "grid", gap: 8, marginBottom: 8 }}>
          <label htmlFor="amc-frequency" style={{ fontSize: 13, fontWeight: 600 }}>Frequency</label>
          <select id="amc-frequency" value={amcFrequency} onChange={(e) => setAmcFrequency(e.target.value)} style={inputStyle}>
            {AMC_FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          <label htmlFor="amc-next-due" style={{ fontSize: 13, fontWeight: 600 }}>First due date</label>
          <input id="amc-next-due" type="date" min={todayIST()} value={amcNextDue} onChange={(e) => setAmcNextDue(e.target.value)} style={inputStyle} />
          <label htmlFor="amc-description" style={{ fontSize: 13, fontWeight: 600 }}>Vendor / description</label>
          <input id="amc-description" value={amcDescription} onChange={(e) => setAmcDescription(e.target.value)} maxLength={200} style={inputStyle} />
        </div>
      </ConfirmDialog>

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
        description={<>Disposal is <b>GFR-irreversible</b>: it removes the asset from the live register, submits a write-off for approval and posts <b>{formatMoney(proceedsToMinorString(proceeds) ?? "0")}</b> proceeds (<b>{DISPOSAL_METHODS.find((m) => m.value === disposalMethod)?.label ?? disposalMethod}</b>) to the GL. This cannot be undone. Provide a reason to proceed.</>}
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
            This <b>bypasses the eOffice write-off approval workflow</b> and marks the asset disposed,
            posting <b>{formatMoney(proceedsToMinorString(directProceeds) ?? "0")}</b> proceeds. It is only applied when
            an approved committee write-off (GFR Rule 173) is on record. This is <b>GFR-irreversible</b> and cannot be
            undone from this screen. Provide a reason to proceed.
          </>
        }
        confirmLabel="Dispose asset"
        danger
        requireReason
        reasonLabel="Reason for direct disposal"
        busy={directDisposeAction.busy}
        errorMessage={directDisposeAction.error}
        onConfirm={directDisposeAction.confirm}
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
