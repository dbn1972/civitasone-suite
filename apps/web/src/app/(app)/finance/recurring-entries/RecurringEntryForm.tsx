"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ConfirmDialog } from "../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";

export type AccountOption = { id: string; code: string; name: string };

type Props = { accounts: AccountOption[] };

const FREQUENCIES = ["daily", "weekly", "monthly", "quarterly", "yearly"] as const;

function rupeesToPaise(val: string): number {
  const n = parseFloat(val);
  return Number.isNaN(n) ? 0 : Math.round(n * 100);
}

type FieldErrors = {
  name?: string;
  debitAccountId?: string;
  creditAccountId?: string;
  amount?: string;
  nextRunDate?: string;
};

export function RecurringEntryForm({ accounts }: Props) {
  const router = useRouter();

  const [name, setName] = useState("");
  const [voucherType, setVoucherType] = useState("journal");
  const [frequency, setFrequency] = useState<(typeof FREQUENCIES)[number]>("monthly");
  const [debitAccountId, setDebitAccountId] = useState(accounts[0]?.id ?? "");
  const [creditAccountId, setCreditAccountId] = useState(accounts[1]?.id ?? accounts[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [narration, setNarration] = useState("");
  const [nextRunDate, setNextRunDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  const nameId = useId();
  const debitId = useId();
  const creditId = useId();
  const freqId = useId();
  const voucherTypeId = useId();
  const amountId = useId();
  const nextRunId = useId();
  const narrationId = useId();
  const endDateId = useId();
  const nameErrId = useId();
  const debitErrId = useId();
  const creditErrId = useId();
  const amountErrId = useId();
  const nextRunErrId = useId();

  const nameRef = useRef<HTMLInputElement>(null);
  const debitRef = useRef<HTMLSelectElement>(null);
  const creditRef = useRef<HTMLSelectElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const nextRunRef = useRef<HTMLInputElement>(null);

  function validate(): boolean {
    const next: FieldErrors = {};
    if (!name.trim()) next.name = "Name is required.";
    if (!debitAccountId) next.debitAccountId = "Debit account is required.";
    if (!creditAccountId) next.creditAccountId = "Credit account is required.";
    if (debitAccountId && creditAccountId && debitAccountId === creditAccountId) {
      next.creditAccountId = "Credit account must differ from the debit account.";
    }
    const paise = rupeesToPaise(amount);
    if (!amount.trim() || paise <= 0) next.amount = "Enter an amount greater than zero.";
    if (!nextRunDate) next.nextRunDate = "Next run date is required.";

    setErrors(next);
    if (next.name) { nameRef.current?.focus(); return false; }
    if (next.debitAccountId) { debitRef.current?.focus(); return false; }
    if (next.creditAccountId) { creditRef.current?.focus(); return false; }
    if (next.amount) { amountRef.current?.focus(); return false; }
    if (next.nextRunDate) { nextRunRef.current?.focus(); return false; }
    return Object.keys(next).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!validate()) return;
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function createEntry() {
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await browserJson<{ id: string; name: string; is_active?: boolean }>(
        "v1/finance/recurring-entries",
        {
          method: "POST",
          body: JSON.stringify({
            name: name.trim(),
            voucherType,
            frequency,
            debitAccountId,
            creditAccountId,
            amountMinor: rupeesToPaise(amount),
            narration: narration.trim() || undefined,
            nextRunDate,
            endDate: endDate || undefined,
          }),
        },
      );
      setConfirmOpen(false);
      setMessage(res?.id ? `Recurring entry "${name.trim()}" created.` : "Recurring entry created.");
      setName("");
      setAmount("");
      setNarration("");
      setNextRunDate("");
      setEndDate("");
      setErrors({});
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const debitAccount = accounts.find((a) => a.id === debitAccountId);
  const creditAccount = accounts.find((a) => a.id === creditAccountId);

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <Card title="Create Recurring Entry" padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={nameId} style={{ fontSize: 13, fontWeight: 600 }}>
                Name <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={nameId}
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={256}
                aria-required="true"
                aria-invalid={!!errors.name || undefined}
                aria-describedby={errors.name ? nameErrId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {errors.name && <p id={nameErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.name}</p>}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={debitId} style={{ fontSize: 13, fontWeight: 600 }}>
                Debit Account <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <select
                id={debitId}
                ref={debitRef}
                value={debitAccountId}
                onChange={(e) => setDebitAccountId(e.target.value)}
                aria-required="true"
                aria-invalid={!!errors.debitAccountId || undefined}
                aria-describedby={errors.debitAccountId ? debitErrId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              >
                <option value="">Select account…</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                ))}
              </select>
              {errors.debitAccountId && <p id={debitErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.debitAccountId}</p>}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={creditId} style={{ fontSize: 13, fontWeight: 600 }}>
                Credit Account <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <select
                id={creditId}
                ref={creditRef}
                value={creditAccountId}
                onChange={(e) => setCreditAccountId(e.target.value)}
                aria-required="true"
                aria-invalid={!!errors.creditAccountId || undefined}
                aria-describedby={errors.creditAccountId ? creditErrId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              >
                <option value="">Select account…</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                ))}
              </select>
              {errors.creditAccountId && <p id={creditErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.creditAccountId}</p>}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={amountId} style={{ fontSize: 13, fontWeight: 600 }}>
                Amount (₹) <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={amountId}
                ref={amountRef}
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-required="true"
                aria-invalid={!!errors.amount || undefined}
                aria-describedby={errors.amount ? amountErrId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {errors.amount && <p id={amountErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.amount}</p>}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={nextRunId} style={{ fontSize: 13, fontWeight: 600 }}>
                Next Run Date <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={nextRunId}
                ref={nextRunRef}
                type="date"
                value={nextRunDate}
                onChange={(e) => setNextRunDate(e.target.value)}
                aria-required="true"
                aria-invalid={!!errors.nextRunDate || undefined}
                aria-describedby={errors.nextRunDate ? nextRunErrId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {errors.nextRunDate && <p id={nextRunErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.nextRunDate}</p>}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={endDateId} style={{ fontSize: 13, fontWeight: 600 }}>End Date</label>
              <input
                id={endDateId}
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 600 }} htmlFor={freqId}>Frequency</label>
              <select
                id={freqId}
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as (typeof FREQUENCIES)[number])}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              >
                {FREQUENCIES.map((f) => (
                  <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>
                ))}
              </select>
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 600 }} htmlFor={voucherTypeId}>Voucher Type</label>
              <input
                id={voucherTypeId}
                value={voucherType}
                onChange={(e) => setVoucherType(e.target.value)}
                maxLength={20}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={narrationId} style={{ fontSize: 13, fontWeight: 600 }}>Narration</label>
              <input
                id={narrationId}
                value={narration}
                onChange={(e) => setNarration(e.target.value)}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
          </div>

          <div>
            <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
              Create Recurring Entry
            </button>
          </div>

          {message && (
            <p role="status" className="pill good" style={{ width: "fit-content" }}>
              {message}
            </p>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title="Create this recurring entry?"
        confirmLabel="Create entry"
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            Create a {frequency} standing entry <strong>{name}</strong> debiting{" "}
            <strong>{debitAccount ? `${debitAccount.code} — ${debitAccount.name}` : debitAccountId}</strong> and
            crediting <strong>{creditAccount ? `${creditAccount.code} — ${creditAccount.name}` : creditAccountId}</strong>.
            It will start posting automatically from the next run date.
          </>
        }
        onConfirm={() => void createEntry()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
