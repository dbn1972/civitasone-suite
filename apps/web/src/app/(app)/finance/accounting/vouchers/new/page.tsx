"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type LineItem = {
  accountCode: string;
  accountName: string;
  debit: string;
  credit: string;
};

const EMPTY_LINE: LineItem = { accountCode: "", accountName: "", debit: "", credit: "" };

export default function NewVoucherPage() {
  const router = useRouter();
  const [lines, setLines] = useState<LineItem[]>([EMPTY_LINE, EMPTY_LINE]);
  const [narration, setNarration] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [submitting, setSubmitting] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
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
      errs.push(`Debit (\u20b9${(totalDebit / 100).toFixed(2)}) must equal Credit (\u20b9${(totalCredit / 100).toFixed(2)})`);
    }
    return errs;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate();
    if (errs.length > 0) { setErrors(errs); return; }
    setErrors([]);
    setInlineError(null);
    setSubmitting(true);
    try {
      const payload = {
        narration,
        lines: lines
          .filter((l) => l.accountCode.trim())
          .map((l) => ({
            accountCode: l.accountCode,
            debitMinor: toPaise(l.debit),
            creditMinor: toPaise(l.credit),
          })),
      };
      const res = await fetch("/api/proxy/v1/finance/journals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 202 || res.ok) {
        router.push("/finance/accounting/general-ledger");
      } else {
        const body = await res.json().catch(() => ({})) as { message?: string };
        setInlineError(body.message ?? `Error ${res.status}`);
      }
    } catch {
      setInlineError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const filledLines = lines.filter((l) => l.accountCode.trim());
  const totalDebit = filledLines.reduce((s, l) => s + toPaise(l.debit), 0);
  const totalCredit = filledLines.reduce((s, l) => s + toPaise(l.credit), 0);
  const isBalanced = totalDebit === totalCredit && totalDebit > 0;

  return (
    <>
      <Link href="/finance/accounting/general-ledger" className="back">\u2190 Back</Link>
      <div className="ph">
        <div>
          <h1>New Journal Voucher</h1>
          <div className="sub">Create a double-entry journal voucher. Debit must equal Credit.</div>
        </div>
      </div>

      {inlineError && (
        <div className="card pad" style={{ borderColor: "#fecaca", background: "#fef2f2" }}>
          <span style={{ color: "#dc2626", fontWeight: 500, fontSize: "0.875rem" }}>{inlineError}</span>
        </div>
      )}

      {errors.length > 0 && (
        <div className="card pad" style={{ borderColor: "#fecaca", background: "#fef2f2" }}>
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {errors.map((err, i) => (
              <li key={i} style={{ fontSize: "0.875rem", color: "#dc2626" }}>\u2022 {err}</li>
            ))}
          </ul>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="card">
          <div className="card-h"><h3>Voucher Header</h3></div>
          <div className="fields pad">
            <div className="field">
              <label className="label">Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="input"
                required
              />
            </div>
            <div className="field">
              <label className="label">Narration</label>
              <input
                type="text"
                value={narration}
                onChange={(e) => setNarration(e.target.value)}
                placeholder="Brief description of the transaction"
                className="input"
                required
              />
            </div>
          </div>
        </div>

        <div className="card" style={{ marginTop: "16px" }}>
          <div className="card-h">
            <h3>Line Items</h3>
            <div className="lnk">
              <button type="button" onClick={addLine} className="btn ghost" style={{ fontSize: "0.8rem", padding: "4px 10px" }}>+ Add Row</button>
            </div>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Account Code</th>
                <th>Account Name</th>
                <th className="num">Debit (\u20b9)</th>
                <th className="num">Credit (\u20b9)</th>
                <th style={{ width: "40px" }}></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, idx) => (
                <tr key={idx}>
                  <td>
                    <input
                      type="text"
                      value={line.accountCode}
                      onChange={(e) => updateLine(idx, "accountCode", e.target.value)}
                      placeholder="e.g. 4001"
                      className="input"
                      style={{ fontSize: "0.8rem", padding: "4px 8px" }}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={line.accountName}
                      onChange={(e) => updateLine(idx, "accountName", e.target.value)}
                      placeholder="Account name"
                      className="input"
                      style={{ fontSize: "0.8rem", padding: "4px 8px" }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      value={line.debit}
                      onChange={(e) => updateLine(idx, "debit", e.target.value)}
                      placeholder="0.00"
                      min="0"
                      step="0.01"
                      className="input num"
                      style={{ fontSize: "0.8rem", padding: "4px 8px", textAlign: "right" }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      value={line.credit}
                      onChange={(e) => updateLine(idx, "credit", e.target.value)}
                      placeholder="0.00"
                      min="0"
                      step="0.01"
                      className="input num"
                      style={{ fontSize: "0.8rem", padding: "4px 8px", textAlign: "right" }}
                    />
                  </td>
                  <td style={{ textAlign: "center" }}>
                    {lines.length > 2 && (
                      <button type="button" onClick={() => removeLine(idx)} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: "0.85rem" }}>\u2715</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2} style={{ textAlign: "right", fontWeight: 600, padding: "10px 12px" }}>Totals</td>
                <td className="num" style={{ fontWeight: 600, color: isBalanced ? "#16a34a" : "#dc2626" }}>
                  \u20b9{(totalDebit / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </td>
                <td className="num" style={{ fontWeight: 600, color: isBalanced ? "#16a34a" : "#dc2626" }}>
                  \u20b9{(totalCredit / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        <div style={{ display: "flex", gap: "10px", marginTop: "16px" }}>
          <button type="submit" disabled={submitting} className="btn primary" onClick={handleSubmit}>
            {submitting ? "Submitting\u2026" : "Submit Voucher"}
          </button>
          <Link href="/finance/accounting/general-ledger" className="btn ghost">Cancel</Link>
        </div>
      </form>
    </>
  );
}
