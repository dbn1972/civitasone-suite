'use client';

import { useState } from "react";
import { useRouter } from "next/navigation";

const PROCUREMENT_METHODS = ["direct_purchase", "gem", "limited_tender", "advertised_tender", "single_tender"] as const;
const QUARTERS = ["Q1", "Q2", "Q3", "Q4"] as const;

type PlanLine = {
  itemCode: string;
  description: string;
  quantity: number;
  uom: string;
  estimatedValueMinor: number;
  procurementMethod: string;
  timelineQuarter: string;
};

function emptyLine(): PlanLine {
  return { itemCode: "", description: "", quantity: 1, uom: "nos", estimatedValueMinor: 0, procurementMethod: "gem", timelineQuarter: "Q1" };
}

export default function NewAnnualPlanPage() {
  const router = useRouter();
  const [planYear, setPlanYear] = useState<string>(String(new Date().getFullYear() + 1));
  const [title, setTitle] = useState("");
  const [department, setDepartment] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<PlanLine[]>([emptyLine()]);
  const [status, setStatus] = useState<"idle" | "submitting" | "accepted" | "error">("idle");
  const [message, setMessage] = useState("");

  function updateLine(i: number, patch: Partial<PlanLine>) {
    setLines((prev) => prev.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !department.trim() || !planYear) {
      setStatus("error"); setMessage("Year, title, and department are required."); return;
    }
    setStatus("submitting"); setMessage("");
    try {
      const res = await fetch("/api/proxy/v1/procurement/plans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          planYear: parseInt(planYear, 10),
          title: title.trim(),
          department: department.trim(),
          notes: notes.trim() || undefined,
          lines: lines.filter((l) => l.itemCode.trim() && l.description.trim()).map((l) => ({
            ...l,
            aggregatedQty: l.quantity,
            procurementCategory: "goods",
          })),
        }),
      });
      const text = await res.text();
      if (!res.ok) { setStatus("error"); setMessage(text || "Request failed"); return; }
      setStatus("accepted"); setMessage("Plan created.");
      setTimeout(() => router.push("/procurement/planning"), 1200);
    } catch (err) {
      setStatus("error"); setMessage(err instanceof Error ? err.message : "Network error");
    }
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ marginBottom: 20 }}>
        <button type="button" onClick={() => router.push("/procurement/planning")} className="btn" style={{ fontSize: 13 }}>← Back to Plans</button>
        <h1 style={{ marginTop: 12, fontSize: 22, fontWeight: 700, color: "var(--ink)" }}>New Annual Procurement Plan</h1>
        <p style={{ color: "var(--ink2)", fontSize: 13 }}>GFR 2017 — Aggregated demand for a financial year</p>
      </div>

      <form onSubmit={(e) => void handleSubmit(e)} noValidate>
        <div className="card pad" style={{ marginBottom: 16 }}>
          <div className="fields">
            <div className="field">
              <label className="label" htmlFor="planYear">Financial year (start) *</label>
              <input id="planYear" type="number" className="inp" value={planYear} onChange={(e) => setPlanYear(e.target.value)} min="2020" max="2100" style={{ minHeight: 44 }} required />
            </div>
            <div className="field">
              <label className="label" htmlFor="dept">Department *</label>
              <input id="dept" className="inp" value={department} onChange={(e) => setDepartment(e.target.value)} style={{ minHeight: 44 }} required />
            </div>
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label className="label" htmlFor="title">Plan title *</label>
              <input id="title" className="inp" value={title} onChange={(e) => setTitle(e.target.value)} style={{ minHeight: 44 }} required />
            </div>
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label className="label" htmlFor="notes">Notes</label>
              <textarea id="notes" className="inp" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="card pad" style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: "var(--ink)" }}>Line items</h2>
          <div className="tbl-wrap">
            <table className="tbl" style={{ minWidth: 800 }}>
              <thead>
                <tr>
                  <th scope="col">Item code</th>
                  <th scope="col">Description</th>
                  <th scope="col" style={{ textAlign: "right" }}>Qty</th>
                  <th scope="col">UoM</th>
                  <th scope="col" style={{ textAlign: "right" }}>Est. value (INR)</th>
                  <th scope="col">Method</th>
                  <th scope="col">Quarter</th>
                  <th scope="col" aria-label="Actions"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td><input className="inp" value={l.itemCode} onChange={(e) => updateLine(i, { itemCode: e.target.value })} style={{ minWidth: 100 }} /></td>
                    <td><input className="inp" value={l.description} onChange={(e) => updateLine(i, { description: e.target.value })} style={{ minWidth: 160 }} /></td>
                    <td><input type="number" className="inp" value={l.quantity} onChange={(e) => updateLine(i, { quantity: Math.max(1, parseInt(e.target.value) || 1) })} style={{ width: 70, textAlign: "right" }} /></td>
                    <td><input className="inp" value={l.uom} onChange={(e) => updateLine(i, { uom: e.target.value })} style={{ width: 60 }} /></td>
                    <td>
                      <input type="number" className="inp" value={l.estimatedValueMinor / 100} onChange={(e) => updateLine(i, { estimatedValueMinor: Math.round((parseFloat(e.target.value) || 0) * 100) })} style={{ width: 120, textAlign: "right" }} step="0.01" />
                    </td>
                    <td>
                      <select className="inp" value={l.procurementMethod} onChange={(e) => updateLine(i, { procurementMethod: e.target.value })}>
                        {PROCUREMENT_METHODS.map((m) => <option key={m} value={m}>{m.replace(/_/g, " ")}</option>)}
                      </select>
                    </td>
                    <td>
                      <select className="inp" value={l.timelineQuarter} onChange={(e) => updateLine(i, { timelineQuarter: e.target.value })}>
                        {QUARTERS.map((q) => <option key={q} value={q}>{q}</option>)}
                      </select>
                    </td>
                    <td>
                      <button type="button" onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))} className="btn" style={{ fontSize: 12, padding: "2px 8px" }} aria-label="Remove line">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" onClick={() => setLines((prev) => [...prev, emptyLine()])} className="btn" style={{ marginTop: 12, fontSize: 13 }}>+ Add line</button>
        </div>

        {message ? <p role={status === "error" ? "alert" : "status"} style={{ marginBottom: 12, color: status === "error" ? "var(--bad)" : "var(--good)", fontSize: 13 }}>{message}</p> : null}
        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={status === "submitting"}>
            {status === "submitting" ? "Creating…" : "Create plan"}
          </button>
          <button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => router.push("/procurement/planning")}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
