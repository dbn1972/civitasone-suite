"use client";

import { useCallback, useId, useState } from "react";
import { useRouter } from "next/navigation";

const TYPES = ["standard", "normal", "emergency"] as const;
const RISKS = ["low", "medium", "high"] as const;

export function NewChangeButton() {
  const router = useRouter();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [type, setType] = useState<(typeof TYPES)[number]>("normal");
  const [risk, setRisk] = useState<(typeof RISKS)[number]>("medium");
  const [services, setServices] = useState("");
  const [description, setDescription] = useState("");
  const [rollbackPlan, setRollbackPlan] = useState("");

  const close = useCallback(() => { if (!busy) { setOpen(false); setError(null); } }, [busy]);

  const submit = useCallback(async () => {
    setError(null);
    if (title.trim().length < 3 || description.trim().length < 10) {
      setError("Title (3+) and description (10+) are required."); return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/proxy/v1/admin/change/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          type,
          risk,
          affectedServices: services.split(",").map((s) => s.trim()).filter(Boolean),
          description: description.trim(),
          ...(rollbackPlan.trim() ? { rollbackPlan: rollbackPlan.trim() } : {}),
        }),
      });
      if (!res.ok) { const t = await res.text(); throw new Error(`Could not raise change (${res.status}). ${t.slice(0, 160)}`); }
      const body = await res.json();
      setOpen(false);
      if (body.id) router.push(`/change/${body.id}`); else router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to raise change.");
    } finally {
      setBusy(false);
    }
  }, [title, type, risk, services, description, rollbackPlan, router]);

  return (
    <>
      <button type="button" className="btn primary" onClick={() => setOpen(true)}>+ Raise change</button>
      {open && (
        <div role="dialog" aria-modal="true" aria-labelledby={titleId}
          onKeyDown={(e) => { if (e.key === "Escape") close(); }}
          style={{ position: "fixed", inset: 0, background: "rgba(16,24,40,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }}>
          <div className="card" style={{ width: "min(560px,100%)", maxHeight: "90vh", overflowY: "auto" }}>
            <div className="card-h"><h3 id={titleId}>Raise change request</h3></div>
            <div className="pad" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label className="lbl" htmlFor="ch-title">Title</label>
              <input id="ch-title" className="inp" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Upgrade payments gateway to v2" />
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label className="lbl" htmlFor="ch-type">Type</label>
                  <select id="ch-type" className="inp" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
                    {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label className="lbl" htmlFor="ch-risk">Risk</label>
                  <select id="ch-risk" className="inp" value={risk} onChange={(e) => setRisk(e.target.value as typeof risk)}>
                    {RISKS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>
              <label className="lbl" htmlFor="ch-svc">Affected services (comma-separated)</label>
              <input id="ch-svc" className="inp" value={services} onChange={(e) => setServices(e.target.value)} placeholder="finance-service, billing-service" />
              <label className="lbl" htmlFor="ch-desc">Description</label>
              <textarea id="ch-desc" className="inp" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is changing and why…" />
              <label className="lbl" htmlFor="ch-rb">Rollback plan (optional now, required before CAB approval)</label>
              <textarea id="ch-rb" className="inp" rows={2} value={rollbackPlan} onChange={(e) => setRollbackPlan(e.target.value)} placeholder="How to revert if the release fails…" />
              {error && <div role="alert" style={{ color: "#b42318", fontSize: 13, marginTop: 4 }}>{error}</div>}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
                <button type="button" className="btn ghost" onClick={close} disabled={busy}>Cancel</button>
                <button type="button" className="btn primary" onClick={() => void submit()} disabled={busy}>{busy ? "Raising…" : "Raise change"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
