"use client";

import { userFacingErrorFromResponse } from "@/lib/api/userFacingFromResponse";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActionButton } from "../../../_components/ds";
import { rupeesToMinorString } from "@/lib/money";
import { formatIndianDate, formatMoney } from "@/lib/formatters";

export type ContractBond = {
  id: string;
  referenceNo?: string;
  status: string;
  amountMinor?: string | number;
  bondType?: string;
  validFrom?: string;
  validTo?: string;
};

// GAP-CONTRACTS-DETAIL-02: contract-service's registerBondBody accepts exactly
// these three bond types (see contract-service .../contracts/validators.ts
// registerBondBody). The officer picks the real one rather than every bond
// being silently filed as "performance".
const BOND_TYPES: Array<{ value: "performance" | "bank_guarantee" | "security_deposit"; label: string }> = [
  { value: "performance", label: "Performance bond" },
  { value: "bank_guarantee", label: "Bank guarantee" },
  { value: "security_deposit", label: "Security deposit" },
];

type Props = { contractId: string; bonds: ContractBond[]; canRegister: boolean };

// held -> {released, claimed, forfeited} are all TERMINAL, one-way transitions
// (see contract-service's assertBondTransition — none of the three has any
// transition out of it). All three are also financially consequential: they
// decide whether a vendor's performance security is returned, kept by the
// government for cause, or kept outright. None of that should fire from a
// single unconfirmed click, and "claim"/"forfeit" specifically allege vendor
// non-performance, so those two require the officer to record why.
const TRANSITIONS: Array<{
  toStatus: "released" | "claimed" | "forfeited";
  label: string;
  confirmTitle: string;
  confirmDescription: string;
  // Distinct from `label`: once the dialog is open, the original trigger
  // button is still on the page, so reusing the same text would leave two
  // same-named buttons visible at once ("Release" the trigger, "Release" the
  // dialog's confirm button).
  confirmLabel: string;
  danger: boolean;
  requireReason: boolean;
}> = [
  {
    toStatus: "released",
    label: "Release",
    confirmTitle: "Release this performance bond?",
    confirmDescription:
      "The bond is returned to the vendor. This cannot be undone or re-registered once released.",
    confirmLabel: "Yes, release",
    danger: false,
    requireReason: false,
  },
  {
    toStatus: "claimed",
    label: "Claim",
    confirmTitle: "Claim this performance bond?",
    confirmDescription:
      "This records the vendor as having failed to perform and invokes the bond. This cannot be undone — record why.",
    confirmLabel: "Yes, claim",
    danger: true,
    requireReason: true,
  },
  {
    toStatus: "forfeited",
    label: "Forfeit",
    confirmTitle: "Forfeit this performance bond?",
    confirmDescription:
      "This permanently forfeits the bond to the government for cause. This cannot be undone — record why.",
    confirmLabel: "Yes, forfeit",
    danger: true,
    requireReason: true,
  },
];

export function BondActions({ contractId, bonds, canRegister }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // Which bond currently has a transition in flight -- disables ALL THREE of
  // that bond's action buttons (not just the one clicked) so a second click
  // can't fire a contradictory transition (e.g. Forfeit right after Claim)
  // before the first has actually landed and router.refresh() re-renders the
  // bond's real status. Scoped per-bond, not global, so other bonds' buttons
  // stay usable.
  const [busyBondId, setBusyBondId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [bondType, setBondType] = useState<"performance" | "bank_guarantee" | "security_deposit">("performance");
  const [issuer, setIssuer] = useState("SBI");
  const [referenceNo, setReferenceNo] = useState("");
  const [amountInr, setAmountInr] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");

  // GAP-CONTRACTS-DETAIL-02: live paise preview of the typed rupees, computed
  // with the same exact string parser used on submit (null when invalid).
  const amountPreviewMinor = rupeesToMinorString(amountInr);
  const amountPreview = amountPreviewMinor ? formatMoney(amountPreviewMinor) : null;

  async function register() {
    setBusy(true);
    setError(undefined);
    setMessage("");
    try {
      // GAP-CONTRACTS-DETAIL-02: exact rupees->paise with string math (no
      // Number()*100 float path, which mis-rounds e.g. 1234.10). Rejects
      // anything with more than two decimals rather than silently rounding
      // a security amount.
      const amountMinor = rupeesToMinorString(amountInr);
      if (amountMinor === null) {
        throw new Error("Enter a positive bond amount in ₹ (up to two decimals)");
      }
      if (!referenceNo.trim()) throw new Error("Reference number is required");
      if (!validFrom) throw new Error("'Valid from' date is required");
      if (!validTo) throw new Error("'Valid to' date is required");
      // GAP-CONTRACTS-DETAIL-02: validity window must be ordered. The server
      // enforces this too (registerPerformanceBond: validTo >= validFrom), but
      // catch it inline so the officer sees it before a round-trip.
      if (validTo < validFrom) {
        throw new Error("'Valid to' must be on or after 'Valid from'");
      }
      const res = await fetch(`/api/proxy/v1/contract/contracts/${contractId}/bonds`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bondType,
          amountMinor: Number(amountMinor),
          currency: "INR",
          issuer,
          referenceNo: referenceNo.trim(),
          validFrom,
          validTo,
        }),
      });
      if (res.status !== 202 && !res.ok) {
        throw await userFacingErrorFromResponse(res, "save");
      }
      setMessage("Performance bond registration received — it will appear shortly.");
      setReferenceNo("");
      setAmountInr("");
      setValidFrom("");
      setValidTo("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bond register failed");
    } finally {
      setBusy(false);
    }
  }

  async function transition(bondId: string, toStatus: "released" | "claimed" | "forfeited", reason?: string) {
    setError(undefined);
    setBusyBondId(bondId);
    try {
      const res = await fetch(
        `/api/proxy/v1/contract/contracts/${contractId}/bonds/${bondId}/transition`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            toStatus,
            notes: reason?.trim() || `${toStatus[0]!.toUpperCase()}${toStatus.slice(1)} from contract detail`,
          }),
        },
      );
      if (res.status !== 202 && !res.ok) {
        throw await userFacingErrorFromResponse(res, "save");
      }
      setMessage(`Bond ${toStatus} request received — the status will update shortly.`);
      router.refresh();
    } finally {
      setBusyBondId(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {bonds.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: "var(--ink2)" }}>No performance bonds registered.</p>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {bonds.map((b) => (
            <li key={b.id} style={{ marginBottom: 8, fontSize: 13 }}>
              <strong>{b.referenceNo ?? b.id.slice(0, 8)}</strong> — {b.status}
              {/* GAP-CONTRACTS-DETAIL-02: surface the bond's validity window so
                  an officer can see at a glance when the security lapses. */}
              {b.validFrom || b.validTo ? (
                <span style={{ color: "var(--ink2)" }}>
                  {" "}· valid {formatIndianDate(b.validFrom ?? null)} – {formatIndianDate(b.validTo ?? null)}
                </span>
              ) : null}
              {b.status === "held" ? (
                <span style={{ display: "inline-flex", gap: 6, marginLeft: 8 }}>
                  {TRANSITIONS.map((t) => (
                    <ActionButton
                      key={t.toStatus}
                      // Leave className unset for claim/forfeit so ActionButton's
                      // own default ("btn danger") applies -- Release keeps the
                      // original neutral "btn ghost" look.
                      {...(t.danger ? {} : { className: "btn ghost" })}
                      label={t.label}
                      disabled={busyBondId === b.id}
                      confirmTitle={t.confirmTitle}
                      confirmDescription={t.confirmDescription}
                      confirmLabel={t.confirmLabel}
                      danger={t.danger}
                      requireReason={t.requireReason}
                      reasonLabel="Reason (recorded on the bond)"
                      // transitionBondBody caps notes at 1000 chars server-side.
                      maxReasonLength={1000}
                      onConfirm={(reason) => transition(b.id, t.toStatus, reason)}
                    />
                  ))}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canRegister ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "end" }}>
          <label style={{ fontSize: 12 }}>
            Bond type
            <select
              className="inp"
              value={bondType}
              onChange={(e) => setBondType(e.target.value as typeof bondType)}
            >
              {BOND_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: 12 }}>
            Issuer
            <input className="inp" value={issuer} onChange={(e) => setIssuer(e.target.value)} />
          </label>
          <label style={{ fontSize: 12 }}>
            Reference
            <input className="inp" value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} placeholder="BG-…" />
          </label>
          <label style={{ fontSize: 12 }}>
            Amount (₹)
            <input className="inp" inputMode="decimal" value={amountInr} onChange={(e) => setAmountInr(e.target.value)} placeholder="100000" />
            {amountPreview ? (
              <span style={{ display: "block", fontSize: 11, color: "var(--ink2)", marginTop: 2 }}>{amountPreview}</span>
            ) : null}
          </label>
          <label style={{ fontSize: 12 }}>
            Valid from
            <input className="inp" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          </label>
          <label style={{ fontSize: 12 }}>
            Valid to
            <input className="inp" type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
          </label>
          <button type="button" className="btn" disabled={busy} onClick={() => void register()}>
            Register bond
          </button>
        </div>
      ) : null}

      {message ? (
        <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--good)", margin: 0 }}>
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" style={{ fontSize: 13, color: "var(--bad)", margin: 0 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
