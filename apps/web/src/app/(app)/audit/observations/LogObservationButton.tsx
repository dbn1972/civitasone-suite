"use client";

import { useCallback, useId, useState } from "react";
import { useRouter } from "next/navigation";

interface FormState {
  obsNo: string;
  auditeeRef: string;
  finding: string;
  category: "performance" | "compliance" | "financial";
  riskLevel: "low" | "medium" | "high";
  amountRupees: string;
}

const EMPTY: FormState = {
  obsNo: "",
  auditeeRef: "",
  finding: "",
  category: "compliance",
  riskLevel: "medium",
  amountRupees: "",
};

export function LogObservationButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const titleId = useId();

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const close = useCallback(() => {
    if (busy) return;
    setOpen(false);
    setError(null);
    setForm(EMPTY);
  }, [busy]);

  const submit = useCallback(async () => {
    setError(null);
    if (!form.obsNo.trim() || !form.auditeeRef.trim() || !form.finding.trim()) {
      setError("Observation number, auditee and finding are required.");
      return;
    }
    const rupees = form.amountRupees.trim();
    let amountInvolvedMinor = "0";
    if (rupees) {
      const n = Number(rupees);
      if (!Number.isFinite(n) || n < 0) {
        setError("Money value must be a non-negative number of rupees.");
        return;
      }
      amountInvolvedMinor = String(Math.round(n * 100));
    }
    setBusy(true);
    try {
      const res = await fetch("/api/proxy/v1/audit/observations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          obsNo: form.obsNo.trim(),
          auditeeRef: form.auditeeRef.trim(),
          finding: form.finding.trim(),
          category: form.category,
          riskLevel: form.riskLevel,
          amountInvolvedMinor,
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Could not log observation (${res.status}). ${txt.slice(0, 160)}`);
      }
      setOpen(false);
      setForm(EMPTY);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to log observation.");
    } finally {
      setBusy(false);
    }
  }, [form, router]);

  return (
    <>
      <button type="button" className="btn primary" onClick={() => setOpen(true)}>+ Log Observation</button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onKeyDown={(e) => { if (e.key === "Escape") close(); }}
          style={{ position: "fixed", inset: 0, background: "rgba(16,24,40,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }}
        >
          <div className="card" style={{ width: "min(520px,100%)", maxHeight: "90vh", overflowY: "auto" }}>
            <div className="card-h"><h3 id={titleId}>Log audit observation</h3></div>
            <div className="pad" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label className="lbl" htmlFor="obs-no">Observation no.</label>
              <input id="obs-no" className="inp" value={form.obsNo} onChange={(e) => set("obsNo", e.target.value)} placeholder="OBS-2026-001" />

              <label className="lbl" htmlFor="obs-auditee">Auditee (dept / unit ref)</label>
              <input id="obs-auditee" className="inp" value={form.auditeeRef} onChange={(e) => set("auditeeRef", e.target.value)} placeholder="Finance Wing" />

              <label className="lbl" htmlFor="obs-finding">Finding</label>
              <textarea id="obs-finding" className="inp" rows={4} value={form.finding} onChange={(e) => set("finding", e.target.value)} placeholder="Describe the audit finding…" />

              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label className="lbl" htmlFor="obs-cat">Category</label>
                  <select id="obs-cat" className="inp" value={form.category} onChange={(e) => set("category", e.target.value as FormState["category"])}>
                    <option value="compliance">Compliance</option>
                    <option value="performance">Performance</option>
                    <option value="financial">Financial</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label className="lbl" htmlFor="obs-risk">Risk</label>
                  <select id="obs-risk" className="inp" value={form.riskLevel} onChange={(e) => set("riskLevel", e.target.value as FormState["riskLevel"])}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
              </div>

              <label className="lbl" htmlFor="obs-amount">Money value (₹, optional)</label>
              <input id="obs-amount" className="inp" inputMode="decimal" value={form.amountRupees} onChange={(e) => set("amountRupees", e.target.value)} placeholder="e.g. 250000" />

              {error && <div role="alert" style={{ color: "var(--bad)", fontSize: 13, marginTop: 4 }}>{error}</div>}

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
                <button type="button" className="btn ghost" onClick={close} disabled={busy}>Cancel</button>
                <button type="button" className="btn primary" onClick={() => void submit()} disabled={busy}>{busy ? "Logging…" : "Log observation"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
