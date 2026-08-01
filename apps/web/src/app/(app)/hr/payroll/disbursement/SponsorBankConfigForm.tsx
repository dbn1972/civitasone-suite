"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";

type SponsorConfig = {
  sponsorCode: string;
  sponsorIfsc: string;
  sponsorAccount: string;
  settlementOffsetDays: number;
  nachEnabled: boolean;
  apbsEnabled: boolean;
} & Record<string, unknown>;

export function SponsorBankConfigForm({ initial }: { initial: SponsorConfig | null }) {
  const router = useRouter();
  const [sponsorCode, setSponsorCode] = useState(initial?.sponsorCode ?? "");
  const [sponsorIfsc, setSponsorIfsc] = useState(initial?.sponsorIfsc ?? "");
  const [sponsorAccount, setSponsorAccount] = useState("");
  const [settlementOffsetDays, setSettlementOffsetDays] = useState(initial?.settlementOffsetDays ?? 1);
  const [nachEnabled, setNachEnabled] = useState(initial?.nachEnabled ?? true);
  const [apbsEnabled, setApbsEnabled] = useState(initial?.apbsEnabled ?? false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [codeInvalid, setCodeInvalid] = useState(false);
  const [ifscInvalid, setIfscInvalid] = useState(false);
  const [acctInvalid, setAcctInvalid] = useState(false);

  const codeId = useId();
  const ifscId = useId();
  const acctId = useId();
  const offsetId = useId();
  const nachId = useId();
  const apbsId = useId();
  const errId = useId();
  const codeRef = useRef<HTMLInputElement>(null);
  const ifscRef = useRef<HTMLInputElement>(null);
  const acctRef = useRef<HTMLInputElement>(null);

  function openConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setMessage(null);
    const codeMissing = !sponsorCode.trim();
    const ifscMissing = !sponsorIfsc.trim();
    const acctMissing = !initial && !sponsorAccount.trim();
    setCodeInvalid(codeMissing);
    setIfscInvalid(ifscMissing);
    setAcctInvalid(acctMissing);
    if (codeMissing || ifscMissing || acctMissing) {
      setError("Sponsor code, IFSC and sponsor account are required.");
      if (codeMissing) {
        codeRef.current?.focus();
      } else if (ifscMissing) {
        ifscRef.current?.focus();
      } else {
        acctRef.current?.focus();
      }
      return;
    }
    setConfirmOpen(true);
  }

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      await browserJson("v1/payroll/sponsor-bank-config", {
        method: "PUT",
        body: JSON.stringify({
          sponsorCode: sponsorCode.trim(),
          sponsorIfsc: sponsorIfsc.trim().toUpperCase(),
          sponsorAccount: sponsorAccount.trim() || undefined,
          settlementOffsetDays,
          nachEnabled,
          apbsEnabled,
        }),
      });
      setConfirmOpen(false);
      setMessage("Sponsor bank configuration saved.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={openConfirm}>
      {initial && (
        <p style={{ fontSize: 13, color: "var(--mut)", marginBottom: 10 }}>
          Currently configured: sponsor account ending in{" "}
          <strong>{initial.sponsorAccount.slice(-4)}</strong>, settlement offset {initial.settlementOffsetDays} day(s).
        </p>
      )}
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
        <div style={{ display: "grid", gap: 6 }}>
          <label htmlFor={codeId} style={{ fontSize: 13, fontWeight: 600 }}>
            Sponsor Code <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
          </label>
          <input
            id={codeId}
            ref={codeRef}
            value={sponsorCode}
            onChange={(e) => {
              setSponsorCode(e.target.value);
              setCodeInvalid(false);
            }}
            maxLength={4}
            aria-required="true"
            aria-invalid={codeInvalid || undefined}
            aria-describedby={codeInvalid ? errId : undefined}
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
          />
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          <label htmlFor={ifscId} style={{ fontSize: 13, fontWeight: 600 }}>
            Sponsor IFSC <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
          </label>
          <input
            id={ifscId}
            ref={ifscRef}
            value={sponsorIfsc}
            onChange={(e) => {
              setSponsorIfsc(e.target.value);
              setIfscInvalid(false);
            }}
            maxLength={11}
            aria-required="true"
            aria-invalid={ifscInvalid || undefined}
            aria-describedby={ifscInvalid ? errId : undefined}
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
          />
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          <label htmlFor={acctId} style={{ fontSize: 13, fontWeight: 600 }}>
            Sponsor Account {!initial && <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>}
          </label>
          <input
            id={acctId}
            ref={acctRef}
            value={sponsorAccount}
            onChange={(e) => {
              setSponsorAccount(e.target.value);
              setAcctInvalid(false);
            }}
            aria-required={!initial}
            aria-invalid={acctInvalid || undefined}
            aria-describedby={acctInvalid ? errId : undefined}
            placeholder={initial ? "Leave blank to keep existing account" : undefined}
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
          />
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          <label htmlFor={offsetId} style={{ fontSize: 13, fontWeight: 600 }}>Settlement Offset (days)</label>
          <input
            id={offsetId}
            type="number"
            min={0}
            value={settlementOffsetDays}
            onChange={(e) => setSettlementOffsetDays(Number(e.target.value))}
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 22 }}>
          <input id={nachId} type="checkbox" checked={nachEnabled} onChange={(e) => setNachEnabled(e.target.checked)} style={{ width: 18, height: 18 }} />
          <label htmlFor={nachId} style={{ fontSize: 13, fontWeight: 600 }}>NACH Enabled</label>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 22 }}>
          <input id={apbsId} type="checkbox" checked={apbsEnabled} onChange={(e) => setApbsEnabled(e.target.checked)} style={{ width: 18, height: 18 }} />
          <label htmlFor={apbsId} style={{ fontSize: 13, fontWeight: 600 }}>APBS Enabled</label>
        </div>
      </div>
      <div style={{ marginTop: 14 }}>
        <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
          {initial ? "Update Configuration" : "Save Configuration"}
        </button>
      </div>
      {error && !confirmOpen && (
        <p id={errId} role="alert" className="pill bad" style={{ marginTop: 10, width: "fit-content" }}>
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="pill good" style={{ marginTop: 10, width: "fit-content" }}>
          {message}
        </p>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Save sponsor bank configuration?"
        danger
        confirmLabel="Save configuration"
        busy={busy}
        errorMessage={error}
        description={
          <>
            This updates the sponsor bank account used to generate all future disbursement files.
            Existing NACH/APBS files already generated are unaffected.
          </>
        }
        onConfirm={() => void save()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
