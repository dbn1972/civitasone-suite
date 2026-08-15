"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const CATEGORIES = [
  { value: "office_supplies", label: "Office Supplies" },
  { value: "communication", label: "Communication" },
  { value: "misc", label: "Miscellaneous" },
] as const;

export function ExpenseClaimForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [form, setForm] = useState({
    category: "office_supplies" as string,
    description: "",
    amount: "",
    receiptAttached: false,
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/proxy/v1/finance/expenses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          category: form.category,
          description: form.description,
          amount: Number(form.amount),
          receiptAttached: form.receiptAttached,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        let msg = `Submission failed (${res.status}).`;
        try { const j = JSON.parse(text); msg = j?.message ?? j?.error ?? msg; } catch { if (text) msg = text; }
        throw new Error(msg);
      }
      setSuccess(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (success) {
    return (
      <div role="status" className="p-4 rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm">
        Expense claim submitted. DDO countersignature will be sought per GFR 2017 Rule 11.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" aria-label="Submit expense claim">
      {error && (
        <div role="alert" className="p-3 rounded bg-red-50 border border-red-200 text-red-800 text-sm">
          {error}
        </div>
      )}

      <div>
        <label htmlFor="expense-category" className="block text-sm font-medium mb-1">
          Category <span aria-hidden="true">*</span>
        </label>
        <select
          id="expense-category"
          required
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          value={form.category}
          onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="expense-description" className="block text-sm font-medium mb-1">
          Description <span aria-hidden="true">*</span>
        </label>
        <textarea
          id="expense-description"
          required
          maxLength={500}
          rows={3}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          placeholder="Contingency expenditure per GFR 2017 Rule 11"
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        />
      </div>

      <div>
        <label htmlFor="expense-amount" className="block text-sm font-medium mb-1">
          Amount (INR) <span aria-hidden="true">*</span>
        </label>
        <input
          id="expense-amount"
          type="number"
          required
          min={1}
          max={100000}
          step={1}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          placeholder="Amount in INR"
          value={form.amount}
          onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
        />
      </div>

      <div>
        <span className="block text-sm font-medium mb-1">Receipt (placeholder)</span>
        <div
          className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center text-sm text-gray-500"
          role="img"
          aria-label="Receipt upload area — coming soon"
        >
          Receipt upload coming soon
        </div>
        <p className="mt-1 text-xs text-gray-500">
          Required for claims above INR 1,000 per GFR 2017 Rule 11.
        </p>
        <label className="mt-2 flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={form.receiptAttached}
            onChange={(e) => setForm((f) => ({ ...f, receiptAttached: e.target.checked }))}
            aria-label="Confirm receipt is available for DDO inspection"
          />
          Receipt available for DDO inspection
        </label>
      </div>

      <div className="pt-2">
        <button type="submit" disabled={busy} className="btn primary" aria-busy={busy}>
          {busy ? "Submitting..." : "Submit Claim"}
        </button>
        <p className="mt-2 text-xs text-gray-500">
          DDO countersignature required before reimbursement (GFR 2017 Rule 11).
        </p>
      </div>
    </form>
  );
}
