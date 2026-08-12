"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type ContractBond = {
  id: string;
  referenceNo?: string;
  status: string;
  amountMinor?: string | number;
  bondType?: string;
};

type Props = { contractId: string; bonds: ContractBond[]; canRegister: boolean };

export function BondActions({ contractId, bonds, canRegister }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [issuer, setIssuer] = useState("SBI");
  const [referenceNo, setReferenceNo] = useState("");
  const [amountInr, setAmountInr] = useState("");

  async function register() {
    setBusy(true);
    setError(undefined);
    setMessage("");
    try {
      const rupees = Number(amountInr);
      if (!Number.isFinite(rupees) || rupees <= 0) {
        throw new Error("Enter a positive bond amount in ₹");
      }
      if (!referenceNo.trim()) throw new Error("Reference number is required");
      const today = new Date().toISOString().slice(0, 10);
      const year = today.slice(0, 4);
      const res = await fetch(`/api/proxy/v1/contract/contracts/${contractId}/bonds`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bondType: "performance",
          amountMinor: Math.round(rupees * 100),
          currency: "INR",
          issuer,
          referenceNo: referenceNo.trim(),
          validFrom: today,
          validTo: `${Number(year) + 1}-12-31`,
        }),
      });
      if (res.status !== 202 && !res.ok) {
        throw new Error((await res.text()) || "Register failed");
      }
      setMessage("Performance bond registration accepted (queued).");
      setReferenceNo("");
      setAmountInr("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bond register failed");
    } finally {
      setBusy(false);
    }
  }

  async function release(bondId: string) {
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch(
        `/api/proxy/v1/contract/contracts/${contractId}/bonds/${bondId}/transition`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toStatus: "released", notes: "Released from contract detail" }),
        },
      );
      if (res.status !== 202 && !res.ok) {
        throw new Error((await res.text()) || "Transition failed");
      }
      setMessage("Bond release accepted (queued).");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bond transition failed");
    } finally {
      setBusy(false);
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
              {b.status === "held" ? (
                <>
                  {" "}
                  <button type="button" className="btn ghost" disabled={busy} onClick={() => void release(b.id)}>
                    Release
                  </button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canRegister ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "end" }}>
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
            <input className="inp" value={amountInr} onChange={(e) => setAmountInr(e.target.value)} placeholder="100000" />
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
