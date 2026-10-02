"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, ConfirmDialog } from "../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { rupeesToMinorString } from "@/lib/money";
import { formatMoney } from "@/lib/formatters";

type Props = { fyCode: string };

type EntryRow = {
  id: number;
  accountCode: string;
  debit: string;
  credit: string;
  narration: string;
};

let _rowId = 0;
function emptyRow(): EntryRow {
  return { id: ++_rowId, accountCode: "", debit: "", credit: "", narration: "" };
}

/**
 * Exact rupees -> paise (bigint), string-based: never parseFloat * 100, which
 * mis-rounds values like 1.005 and loses precision above 2^53. A blank cell is
 * 0; anything that isn't a plain amount with at most 2 decimals is null
 * (rejected, never guessed).
 */
function rupeesToPaise(val: string): bigint | null {
  if (!val.trim()) return 0n;
  const minor = rupeesToMinorString(val, { allowZero: true });
  return minor === null ? null : BigInt(minor);
}

/** Minimum stated-reason length (matches finance-service's reasonField). */
const OB_REASON_MIN = 10;

export function OpeningBalanceForm({ fyCode }: Props) {
  const router = useRouter();

  const [rows, setRows] = useState<EntryRow[]>([emptyRow(), emptyRow()]);
  const [rowError, setRowError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  const rowRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const [invalidRowId, setInvalidRowId] = useState<number | null>(null);
  const errId = useId();
  function focusRow(id: number | undefined) {
    if (id != null) rowRefs.current[id]?.focus();
  }

  function updateRow(id: number, patch: Partial<EntryRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, emptyRow()]);
  }

  function removeRow(id: number) {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));
  }

  function activeEntries() {
    return rows.filter((r) => r.accountCode.trim() || r.debit.trim() || r.credit.trim());
  }

  function validate(): boolean {
    const entries = activeEntries();
    setInvalidRowId(null);
    if (entries.length === 0) {
      setRowError("Enter at least one account with a debit or credit amount.");
      focusRow(rows[0]?.id);
      return false;
    }
    for (const r of entries) {
      if (!r.accountCode.trim()) {
        setRowError("Every row with an amount needs an account code.");
        setInvalidRowId(r.id);
        focusRow(r.id);
        return false;
      }
      const debit = rupeesToPaise(r.debit);
      const credit = rupeesToPaise(r.credit);
      if (debit === null || credit === null) {
        setRowError(`Row for account ${r.accountCode}: enter amounts in rupees with at most 2 decimals (e.g. 1234.50).`);
        setInvalidRowId(r.id);
        focusRow(r.id);
        return false;
      }
      if (debit <= 0n && credit <= 0n) {
        setRowError(`Row for account ${r.accountCode} needs a debit or credit amount greater than zero.`);
        setInvalidRowId(r.id);
        focusRow(r.id);
        return false;
      }
    }
    // Balanced-entry check: opening balances seed the trial balance, so total
    // debits MUST equal total credits — an unbalanced set corrupts the GL (fail closed).
    const totalDebit = entries.reduce((s, r) => s + (rupeesToPaise(r.debit) ?? 0n), 0n);
    const totalCredit = entries.reduce((s, r) => s + (rupeesToPaise(r.credit) ?? 0n), 0n);
    if (totalDebit !== totalCredit) {
      const diff = totalDebit > totalCredit ? totalDebit - totalCredit : totalCredit - totalDebit;
      setRowError(`Total debits (${formatMoney(totalDebit)}) must equal total credits (${formatMoney(totalCredit)}). Difference: ${formatMoney(diff)}.`);
      focusRow(rows[0]?.id);
      return false;
    }
    setRowError(null);
    return true;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!validate()) return;
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function submitEntries(reason?: string) {
    setBusy(true);
    setDialogError(undefined);
    try {
      const entries = activeEntries().map((r) => ({
        accountCode: r.accountCode.trim(),
        // paise as base-10 strings (bigint-safe; validate() already rejected bad input)
        debitMinor: (rupeesToPaise(r.debit) ?? 0n).toString(),
        creditMinor: (rupeesToPaise(r.credit) ?? 0n).toString(),
        narration: r.narration.trim() || undefined,
      }));

      const res = await browserJson<{ status: string; count: number }>("v1/finance/opening-balances", {
        method: "POST",
        body: JSON.stringify({ fyCode, entries, reason }),
      });

      setConfirmOpen(false);
      setMessage(`${res?.count ?? entries.length} opening balance ${((res?.count ?? entries.length) === 1) ? "entry" : "entries"} saved for ${fyCode}.`);
      setRows([emptyRow(), emptyRow()]);
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const entryCount = activeEntries().length;

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <Card title={`Set Opening Balances — ${fyCode}`} padding>
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <caption className="sr-only">Opening balance entries for fiscal year {fyCode}</caption>
              <thead>
                <tr>
                  <th scope="col">Account Code</th>
                  <th scope="col">Debit (₹)</th>
                  <th scope="col">Credit (₹)</th>
                  <th scope="col">Narration</th>
                  <th scope="col">Remove</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <tr key={row.id}>
                    <td>
                      <label htmlFor={`ob-account-${row.id}`} className="sr-only">Account code, row {idx + 1}</label>
                      <input
                        id={`ob-account-${row.id}`}
                        ref={(el) => { rowRefs.current[row.id] = el; }}
                        value={row.accountCode}
                        onChange={(e) => updateRow(row.id, { accountCode: e.target.value })}
                        maxLength={20}
                        aria-invalid={invalidRowId === row.id || undefined}
                        aria-describedby={invalidRowId === row.id ? errId : undefined}
                        style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 40, width: "100%" }}
                      />
                    </td>
                    <td>
                      <label htmlFor={`ob-debit-${row.id}`} className="sr-only">Debit amount, row {idx + 1}</label>
                      <input
                        id={`ob-debit-${row.id}`}
                        inputMode="decimal"
                        value={row.debit}
                        onChange={(e) => updateRow(row.id, { debit: e.target.value })}
                        style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 40, width: "100%" }}
                      />
                    </td>
                    <td>
                      <label htmlFor={`ob-credit-${row.id}`} className="sr-only">Credit amount, row {idx + 1}</label>
                      <input
                        id={`ob-credit-${row.id}`}
                        inputMode="decimal"
                        value={row.credit}
                        onChange={(e) => updateRow(row.id, { credit: e.target.value })}
                        style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 40, width: "100%" }}
                      />
                    </td>
                    <td>
                      <label htmlFor={`ob-narration-${row.id}`} className="sr-only">Narration, row {idx + 1}</label>
                      <input
                        id={`ob-narration-${row.id}`}
                        value={row.narration}
                        onChange={(e) => updateRow(row.id, { narration: e.target.value })}
                        maxLength={500}
                        style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 40, width: "100%" }}
                      />
                    </td>
                    <td>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove row ${idx + 1}`}
                        onClick={() => removeRow(row.id)}
                        disabled={rows.length <= 1}
                      >
                        ✕
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <Button type="button" variant="ghost" onClick={addRow}>+ Add row</Button>
            <Button type="submit" style={{ minHeight: 44 }} disabled={busy}>
              Save Opening Balances ({entryCount})
            </Button>
          </div>

          {rowError && (
            <p id={errId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{rowError}</p>
          )}

          {message && (
            <p role="status" className="pill good" style={{ width: "fit-content" }}>
              {message}
            </p>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title="Save these opening balances?"
        confirmLabel="Save opening balances"
        danger
        requireReason
        reasonLabel="Reason / approving authority"
        minReasonLength={OB_REASON_MIN}
        maxReasonLength={500}
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            Save <strong>{entryCount}</strong> opening balance {entryCount === 1 ? "entry" : "entries"} for fiscal
            year <strong>{fyCode}</strong>. They are saved immediately (there is no separate approval step) and set
            the starting position of the ledger for these accounts; they cannot be edited or undone from this screen.
            State the reason and the authority approving these figures — it is recorded in the audit trail.
          </>
        }
        onConfirm={(reason) => void submitEntries(reason)}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
