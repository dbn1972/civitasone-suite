"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ConfirmDialog } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";
import { rupeesToMinorString } from "@/lib/money";
import type { PolicyOption } from "./page";

type AcceptedResponse = { id?: string; status?: string; correlationId?: string };

const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 } as const;

/** Custom date validator — NOT native min/max. Requires ISO yyyy-MM-dd and a real calendar date, not in the future. */
function validateClaimDate(value: string): string | null {
  if (!value) return "Enter the claim date.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Enter a valid date (yyyy-mm-dd).";
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "Enter a valid calendar date.";
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  if (d.getTime() > today.getTime()) return "Claim date cannot be in the future.";
  return null;
}

export function ClaimForm({
  policies,
  preselectedPolicyId,
}: {
  policies: PolicyOption[];
  preselectedPolicyId?: string;
}) {
  const router = useRouter();

  const eligiblePolicies = policies.filter((p) => p.status === "active");
  const initialPolicyId = preselectedPolicyId && eligiblePolicies.some((p) => p.id === preselectedPolicyId) ? preselectedPolicyId : "";

  const [policyId, setPolicyId] = useState(initialPolicyId);
  const [claimDate, setClaimDate] = useState("");
  const [claimAmount, setClaimAmount] = useState("");
  const [notes, setNotes] = useState("");

  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const policySelectId = useId();
  const claimDateId = useId();
  const claimAmountId = useId();
  const notesId = useId();
  const summaryId = useId();
  const noPoliciesHelpId = useId();

  const policyRef = useRef<HTMLSelectElement>(null);
  const claimDateRef = useRef<HTMLInputElement>(null);
  const claimAmountRef = useRef<HTMLInputElement>(null);

  const selectedPolicy = eligiblePolicies.find((p) => p.id === policyId);
  const noEligiblePolicies = eligiblePolicies.length === 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);

    const errors: Record<string, string> = {};
    if (!policyId) errors.policyId = "Select the policy this claim is against.";

    const dateErr = validateClaimDate(claimDate);
    if (dateErr) errors.claimDate = dateErr;

    const claimAmountMinorStr = rupeesToMinorString(claimAmount);
    if (!claimAmountMinorStr) {
      errors.claimAmount = "Enter a valid claim amount (e.g. 8000 or 8000.50).";
    } else if (selectedPolicy) {
      // Client-side guard mirroring the server's CLAIM_EXCEEDS_COVERAGE rule —
      // the server is still authoritative and re-checks this on submit.
      const coverage = BigInt(selectedPolicy.coverageMinor);
      const amount = BigInt(claimAmountMinorStr);
      if (amount > coverage) {
        errors.claimAmount = `Claim amount cannot exceed the policy's sum insured (${formatMoney(selectedPolicy.coverageMinor)}).`;
      }
    }

    setFieldErrors(errors);

    if (Object.keys(errors).length > 0) {
      setTone("bad");
      setMessage("Please correct the highlighted fields.");
      if (errors.policyId) policyRef.current?.focus();
      else if (errors.claimDate) claimDateRef.current?.focus();
      else if (errors.claimAmount) claimAmountRef.current?.focus();
      return;
    }

    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function fileClaim() {
    if (!selectedPolicy) return;
    const claimAmountMinorStr = rupeesToMinorString(claimAmount);
    if (!claimAmountMinorStr) return;

    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await browserJson<AcceptedResponse>("v1/assets/insurance/claims", {
        method: "POST",
        body: JSON.stringify({
          policyId: selectedPolicy.id,
          assetId: selectedPolicy.assetId,
          claimDate,
          claimAmountMinor: Number(claimAmountMinorStr),
          currency: "INR",
          notes: notes.trim() || undefined,
        }),
      });
      setConfirmOpen(false);
      setTone("good");
      setMessage(
        res.id
          ? `Claim submitted (id ${res.id}). It is processed asynchronously and will appear below shortly.`
          : "Claim submitted.",
      );
      setPolicyId("");
      setClaimDate("");
      setClaimAmount("");
      setNotes("");
      setFieldErrors({});
      router.refresh();
    } catch (err) {
      // Surfaces the real server code/message (e.g. "CLAIM_EXCEEDS_COVERAGE: …"
      // or "POLICY_NOT_FOUND: …") rather than a generic failure banner.
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }} aria-label="File an insurance claim">
      <Card title="File a Claim" padding>
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={policySelectId} style={{ fontSize: 13, fontWeight: 600 }}>
              Policy <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <select
              id={policySelectId}
              ref={policyRef}
              value={policyId}
              onChange={(e) => setPolicyId(e.target.value)}
              aria-required="true"
              aria-invalid={!!fieldErrors.policyId || undefined}
              aria-describedby={fieldErrors.policyId ? `${policySelectId}-error` : undefined}
              style={inputStyle}
            >
              <option value="">Select a policy…</option>
              {eligiblePolicies.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.policyNo} · {p.insurer} — sum insured {formatMoney(p.coverageMinor)}
                </option>
              ))}
            </select>
            {fieldErrors.policyId && (
              <p id={`${policySelectId}-error`} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad, #c0392b)" }}>
                {fieldErrors.policyId}
              </p>
            )}
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={claimDateId} style={{ fontSize: 13, fontWeight: 600 }}>
              Claim Date <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={claimDateId}
              ref={claimDateRef}
              type="date"
              value={claimDate}
              onChange={(e) => setClaimDate(e.target.value)}
              aria-required="true"
              aria-invalid={!!fieldErrors.claimDate || undefined}
              aria-describedby={fieldErrors.claimDate ? `${claimDateId}-error` : undefined}
              style={inputStyle}
            />
            {fieldErrors.claimDate && (
              <p id={`${claimDateId}-error`} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad, #c0392b)" }}>
                {fieldErrors.claimDate}
              </p>
            )}
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={claimAmountId} style={{ fontSize: 13, fontWeight: 600 }}>
              Claim Amount (₹) <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={claimAmountId}
              ref={claimAmountRef}
              inputMode="decimal"
              value={claimAmount}
              onChange={(e) => setClaimAmount(e.target.value)}
              aria-required="true"
              aria-invalid={!!fieldErrors.claimAmount || undefined}
              aria-describedby={fieldErrors.claimAmount ? `${claimAmountId}-error` : undefined}
              style={inputStyle}
            />
            {fieldErrors.claimAmount && (
              <p id={`${claimAmountId}-error`} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad, #c0392b)" }}>
                {fieldErrors.claimAmount}
              </p>
            )}
          </div>

          <div style={{ display: "grid", gap: 6, gridColumn: "1 / -1" }}>
            <label htmlFor={notesId} style={{ fontSize: 13, fontWeight: 600 }}>
              Notes
            </label>
            <input id={notesId} value={notes} onChange={(e) => setNotes(e.target.value)} style={inputStyle} />
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <button
            type="submit"
            className="btn primary"
            style={{ minHeight: 44 }}
            disabled={busy || noEligiblePolicies}
            aria-label="File insurance claim"
            aria-describedby={noEligiblePolicies ? noPoliciesHelpId : undefined}
          >
            File Claim
          </button>
          {noEligiblePolicies && (
            <p id={noPoliciesHelpId} style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--ink2)" }}>
              No active policies available to file a claim against.
            </p>
          )}
        </div>

        {message && (
          <p
            id={summaryId}
            role={tone === "bad" ? "alert" : "status"}
            className={`pill ${tone}`}
            style={{ width: "fit-content", marginTop: 12 }}
          >
            {message}
          </p>
        )}
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title="File this claim?"
        confirmLabel="File claim"
        busy={busy}
        errorMessage={dialogError}
        description={
          selectedPolicy ? (
            <>
              File a claim of <strong>{formatMoney(rupeesToMinorString(claimAmount) ?? "0")}</strong> against policy{" "}
              <strong>{selectedPolicy.policyNo}</strong> ({selectedPolicy.insurer}), sum insured{" "}
              <strong>{formatMoney(selectedPolicy.coverageMinor)}</strong>.
            </>
          ) : (
            "File this claim?"
          )
        }
        onConfirm={() => void fileClaim()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
