"use client";

import { useState } from "react";
import Link from "next/link";

type LineItem = {
  accountCode: string;
  accountName: string;
  debit: string;
  credit: string;
};

const EMPTY_LINE: LineItem = { accountCode: "", accountName: "", debit: "", credit: "" };

export default function NewVoucherPage() {
  const [lines, setLines] = useState<LineItem[]>([EMPTY_LINE, EMPTY_LINE]);
  const [narration, setNarration] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const updateLine = (idx: number, field: keyof LineItem, value: string) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  };

  const addLine = () => setLines((prev) => [...prev, { ...EMPTY_LINE }]);
  const removeLine = (idx: number) => setLines((prev) => prev.filter((_, i) => i !== idx));

  const toPaise = (val: string) => Math.round(parseFloat(val || "0") * 100);

  const validate = () => {
    const errs: string[] = [];
    if (!date) errs.push("Date is required");
    if (!narration.trim()) errs.push("Narration is required");
    const filledLines = lines.filter((l) => l.accountCode.trim());
    if (filledLines.length < 2) errs.push("At least 2 line items required");
    const totalDebit = filledLines.reduce((s, l) => s + toPaise(l.debit), 0);
    const totalCredit = filledLines.reduce((s, l) => s + toPaise(l.credit), 0);
    if (totalDebit !== totalCredit) {
      errs.push(`Debit (₹${(totalDebit / 100).toFixed(2)}) must equal Credit (₹${(totalCredit / 100).toFixed(2)})`);
    }
    return errs;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate();
    if (errs.length > 0) { setErrors(errs); return; }
    setErrors([]);
    setSubmitting(true);
    try {
      const payload = {
        date,
        narration,
        lineItems: lines
          .filter((l) => l.accountCode.trim())
          .map((l) => ({
            accountCode: l.accountCode,
            debitPaise: toPaise(l.debit),
            creditPaise: toPaise(l.credit),
          })),
      };
      const res = await fetch("/api/proxy/v1/finance/journals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 202 || res.ok) {
        setToast({ type: "success", message: "Voucher submitted successfully" });
        setLines([{ ...EMPTY_LINE }, { ...EMPTY_LINE }]);
        setNarration("");
      } else {
        const body = await res.json().catch(() => ({})) as { message?: string };
        setToast({ type: "error", message: body.message ?? `Error ${res.status}` });
      }
    } catch {
      setToast({ type: "error", message: "Network error. Please try again." });
    } finally {
      setSubmitting(false);
      setTimeout(() => setToast(null), 5000);
    }
  };

  const filledLines = lines.filter((l) => l.accountCode.trim());
  const totalDebit = filledLines.reduce((s, l) => s + toPaise(l.debit), 0);
  const totalCredit = filledLines.reduce((s, l) => s + toPaise(l.credit), 0);
  const isBalanced = totalDebit === totalCredit && totalDebit > 0;

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-4xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/finance" className="hover:text-slate-900">Finance</Link>
          <span className="mx-2">/</span>
          <Link href="/finance/accounting/general-ledger" className="hover:text-slate-900">General Ledger</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">New Voucher</span>
        </nav>

        <header>
          <h1 className="text-3xl font-semibold text-slate-900">New Journal Voucher</h1>
          <p className="mt-1 text-sm text-slate-600">Create a double-entry journal voucher. Debit must equal Credit.</p>
        </header>

        {toast && (
          <div className={`rounded-xl border px-4 py-3 text-sm font-medium ${toast.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}>
            {toast.message}
          </div>
        )}

        {errors.length > 0 && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <ul className="space-y-1 text-sm text-red-700">
              {errors.map((err, i) => <li key={i}>• {err}</li>)}
            </ul>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-slate-700">Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Narration</label>
                <input
                  type="text"
                  value={narration}
                  onChange={(e) => setNarration(e.target.value)}
                  placeholder="Brief description of the transaction"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  required
                />
              </div>
            </div>
          </section>

          <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <span className="text-sm font-semibold text-slate-800">Line Items</span>
              <button type="button" onClick={addLine} className="text-sm text-indigo-600 hover:underline">
                + Add Row
              </button>
            </div>
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="px-3 py-2 text-left">Account Code</th>
                  <th className="px-3 py-2 text-left">Account Name</th>
                  <th className="px-3 py-2 text-right">Debit (₹)</th>
                  <th className="px-3 py-2 text-right">Credit (₹)</th>
                  <th className="px-3 py-2 text-center w-12">–</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, idx) => (
                  <tr key={idx} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={line.accountCode}
                        onChange={(e) => updateLine(idx, "accountCode", e.target.value)}
                        placeholder="e.g. 4001"
                        className="w-full rounded border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={line.accountName}
                        onChange={(e) => updateLine(idx, "accountName", e.target.value)}
                        placeholder="Account name"
                        className="w-full rounded border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        value={line.debit}
                        onChange={(e) => updateLine(idx, "debit", e.target.value)}
                        placeholder="0.00"
                        min="0"
                        step="0.01"
                        className="w-full rounded border border-slate-300 px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-indigo-400"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        value={line.credit}
                        onChange={(e) => updateLine(idx, "credit", e.target.value)}
                        placeholder="0.00"
                        min="0"
                        step="0.01"
                        className="w-full rounded border border-slate-300 px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-indigo-400"
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      {lines.length > 2 ? (
                        <button
                          type="button"
                          onClick={() => removeLine(idx)}
                          className="text-xs text-red-500 hover:text-red-700"
                          aria-label="Remove row"
                        >
                          ✕
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-slate-200 bg-slate-50 text-sm font-medium">
                <tr>
                  <td colSpan={2} className="px-3 py-2 text-right text-slate-600">Totals:</td>
                  <td className={`px-3 py-2 text-right ${isBalanced ? "text-emerald-700" : "text-red-700"}`}>
                    ₹{(totalDebit / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </td>
                  <td className={`px-3 py-2 text-right ${isBalanced ? "text-emerald-700" : "text-red-700"}`}>
                    ₹{(totalCredit / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </section>

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-indigo-600 px-6 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {submitting ? "Submitting…" : "Submit Voucher"}
            </button>
            <Link href="/finance/accounting/general-ledger" className="rounded-md border border-slate-300 px-6 py-2 text-sm text-slate-700 hover:bg-slate-50">
              Cancel
            </Link>
          </div>
        </form>
      </section>
    </main>
  );
}
