"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Card, ConfirmDialog, RefreshErrorState } from "../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { parseRupeesToPaise } from "@/lib/money";
import { formatMoney, formatIndianDate, todayIST } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { FREQUENCIES, VOUCHER_TYPES, isValidFrequency, isValidVoucherType, validateRunDates } from "./recurringForm";

export type AccountOption = { id: string; code: string; name: string };

type Props = {
  accounts: AccountOption[];
  /** The chart-of-accounts fetch failed (as opposed to returning an empty list). */
  accountsError?: boolean;
};

type FieldErrors = {
  name?: string;
  debitAccountId?: string;
  creditAccountId?: string;
  amount?: string;
  nextRunDate?: string;
  endDate?: string;
  voucherType?: string;
};

export function RecurringEntryForm({ accounts, accountsError = false }: Props) {
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
  const endDateErrId = useId();
  const amountPreviewId = useId();

  const nameRef = useRef<HTMLInputElement>(null);
  const debitRef = useRef<HTMLSelectElement>(null);
  const creditRef = useRef<HTMLSelectElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const nextRunRef = useRef<HTMLInputElement>(null);
  const endDateRef = useRef<HTMLInputElement>(null);

  const noAccounts = !accountsError && accounts.length === 0;
  const blocked = accountsError || noAccounts;
  const today = todayIST();
  // Money is parsed to paise digit-string with BigInt, never parseFloat: "1,20,000" is
  // 12000000 paise, "1.005" and "12abc" are rejected (GAP-FINANCE-RECURRING-ENTRIES-05).
  const paise = parseRupeesToPaise(amount);

  function validate(): boolean {
    const next: FieldErrors = {};
    if (!name.trim()) next.name = "Name is required.";
    if (!debitAccountId) next.debitAccountId = "Debit account is required.";
    if (!creditAccountId) next.creditAccountId = "Credit account is required.";
    if (debitAccountId && creditAccountId && debitAccountId === creditAccountId) {
      next.creditAccountId = "Credit account must differ from the debit account.";
    }
    if (paise === null || !Number.isSafeInteger(Number(paise))) {
      next.amount = "Enter a valid amount like 1,20,000.50 (rupees, at most 2 decimals, greater than zero).";
    }
    if (!isValidVoucherType(voucherType)) next.voucherType = "Choose a voucher type from the list.";
    if (!isValidFrequency(frequency)) next.voucherType = next.voucherType ?? "Choose a frequency from the list.";
    Object.assign(next, validateRunDates(nextRunDate, endDate, today));

    setErrors(next);
    if (next.name) { nameRef.current?.focus(); return false; }
    if (next.debitAccountId) { debitRef.current?.focus(); return false; }
    if (next.creditAccountId) { creditRef.current?.focus(); return false; }
    if (next.amount) { amountRef.current?.focus(); return false; }
    if (next.nextRunDate) { nextRunRef.current?.focus(); return false; }
    if (next.endDate) { endDateRef.current?.focus(); return false; }
    if (next.voucherType) return false;
    return Object.keys(next).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (blocked || !validate()) return;
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
            // The create route takes a JSON integer; safe-integer was checked in validate().
            amountMinor: Number(paise),
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
    <form onSubmit={handleSubmit} noValidate style={{ marginBottom: 16 }}>
      <Card title="Create Recurring Entry" padding>
        <div style={{ display: "grid", gap: 14 }}>
          {accountsError && (
            <RefreshErrorState
              error={toHumanError("load", { area: "chart of accounts" })}
              backHref="/finance"
            />
          )}
          {noAccounts && (
            <p role="alert" className="pill warn" style={{ width: "fit-content" }}>
              No accounts defined. Create accounts in the{" "}
              <Link href="/finance/chart-of-accounts">Chart of Accounts</Link> before adding a recurring entry.
            </p>
          )}
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
                aria-describedby={errors.amount ? `${amountErrId} ${amountPreviewId}` : amountPreviewId}
                autoComplete="off"
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              <span id={amountPreviewId} style={{ fontSize: 12, color: "var(--ink2)" }}>
                {paise !== null ? formatMoney(paise) : "Enter rupees, e.g. 1,20,000.50"}
              </span>
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
                min={today}
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
                ref={endDateRef}
                type="date"
                min={nextRunDate || today}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                aria-invalid={!!errors.endDate || undefined}
                aria-describedby={errors.endDate ? endDateErrId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {errors.endDate && <p id={endDateErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.endDate}</p>}
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
              <select
                id={voucherTypeId}
                value={voucherType}
                onChange={(e) => setVoucherType(e.target.value)}
                aria-invalid={!!errors.voucherType || undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              >
                {VOUCHER_TYPES.map((v) => (
                  <option key={v.value} value={v.value}>{v.label}</option>
                ))}
              </select>
              {errors.voucherType && <p role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.voucherType}</p>}
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
            <Button type="submit" style={{ minHeight: 44 }} disabled={busy || blocked}>
              Create Recurring Entry
            </Button>
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
            <dl style={{ margin: "12px 0 0", display: "grid", gridTemplateColumns: "max-content 1fr", gap: "4px 16px" }}>
              <dt>Amount</dt>
              <dd style={{ margin: 0 }}><strong>{paise !== null ? formatMoney(paise) : "—"}</strong> each time it runs</dd>
              <dt>Voucher type</dt>
              <dd style={{ margin: 0 }}>{VOUCHER_TYPES.find((v) => v.value === voucherType)?.label ?? voucherType}</dd>
              <dt>Next run</dt>
              <dd style={{ margin: 0 }}>{formatIndianDate(nextRunDate)}</dd>
              <dt>Ends</dt>
              <dd style={{ margin: 0 }}>{endDate ? formatIndianDate(endDate) : "No end date"}</dd>
              {narration.trim() ? (<><dt>Narration</dt><dd style={{ margin: 0 }}>{narration.trim()}</dd></>) : null}
            </dl>
            <p style={{ margin: "8px 0 0" }}>
              This records the schedule only. Nothing is posted automatically: templates that fall due are flagged at
              period close, and the journal must be posted by hand.
            </p>
          </>
        }
        onConfirm={() => void createEntry()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
