"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ConfirmDialog } from "../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";

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

function rupeesToPaise(val: string): number {
  const n = parseFloat(val);
  return Number.isNaN(n) ? 0 : Math.round(n * 100);
}

export function OpeningBalanceForm({ fyCode }: Props) {
  const router = useRouter();

  const [rows, setRows] = useState<EntryRow[]>([emptyRow(), emptyRow()]);
  const [rowError, setRowError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  const firstAccountRef = useRef<HTMLInputElement>(null);
  const errId = useId();

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
    if (entries.length === 0) {
      setRowError("Enter at least one account with a debit or credit amount.");
      firstAccountRef.current?.focus();
      return false;
    }
    for (const r of entries) {
      if (!r.accountCode.trim()) {
        setRowError("Every row with an amount needs an account code.");
        return false;
      }
      const debit = rupeesToPaise(r.debit);
      const credit = rupeesToPaise(r.credit);
      if (debit <= 0 && credit <= 0) {
        setRowError(`Row for account ${r.accountCode} needs a debit or credit amount greater than zero.`);
        return false;
      }
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

  async function submitEntries() {
    setBusy(true);
    setDialogError(undefined);
    try {
      const entries = activeEntries().map((r) => ({
        accountCode: r.accountCode.trim(),
        debitMinor: rupeesToPaise(r.debit),
        creditMinor: rupeesToPaise(r.credit),
        narration: r.narration.trim() || undefined,
      }));

      const res = await browserJson<{ status: string; count: number }>("v1/finance/opening-balances", {
        method: "POST",
        body: JSON.stringify({ fyCode, entries }),
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
                        ref={idx === 0 ? firstAccountRef : undefined}
                        value={row.accountCode}
                        onChange={(e) => updateRow(row.id, { accountCode: e.target.value })}
                        maxLength={20}
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
                      <button
                        type="button"
                        className="btn ghost sm"
                        aria-label={`Remove row ${idx + 1}`}
                        onClick={() => removeRow(row.id)}
                        disabled={rows.length <= 1}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" className="btn ghost" onClick={addRow}>+ Add row</button>
            <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
              Save Opening Balances ({entryCount})
            </button>
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
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            Save <strong>{entryCount}</strong> opening balance {entryCount === 1 ? "entry" : "entries"} for fiscal
            year <strong>{fyCode}</strong>. This sets the starting position for these accounts and cannot be undone
            from this screen.
          </>
        }
        onConfirm={() => void submitEntries()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
