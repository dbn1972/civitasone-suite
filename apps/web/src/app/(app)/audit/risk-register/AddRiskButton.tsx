"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormError } from "@/lib/useFormError";
import { Button } from "@/app/_components/ds";

const LIKELIHOOD = ["rare", "unlikely", "possible", "likely", "almost_certain"] as const;
const IMPACT = ["negligible", "minor", "moderate", "major", "catastrophic"] as const;
const CATEGORY = ["financial", "operational", "compliance", "reputational", "strategic", "it"] as const;

export function AddRiskButton() {
  const router = useRouter();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [riskCode, setRiskCode] = useState("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORY)[number]>("operational");
  const [likelihood, setLikelihood] = useState<(typeof LIKELIHOOD)[number]>("possible");
  const [impact, setImpact] = useState<(typeof IMPACT)[number]>("moderate");
  const [owner, setOwner] = useState("");
  const formError = useFormError("risk");

  const close = useCallback(() => { if (!busy) { setOpen(false); setError(null); } }, [busy]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, close]);

  const submit = useCallback(async () => {
    setError(null);
    if (!riskCode.trim() || !title.trim()) { setError("Risk code and title are required."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/proxy/v1/audit/risks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          riskCode: riskCode.trim(),
          title: title.trim(),
          category,
          likelihood,
          impact,
          ...(owner.trim() ? { owner: owner.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setError(resolved.message);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError(formError.fromException("save").message);
    } finally {
      setBusy(false);
    }
    // formError.fromResponse/fromException are stable (useCallback'd on a
    // fixed `area` string inside useFormError) even though the wrapping
    // `formError` object literal isn't, so omitting it here is safe.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- formError.fromResponse/fromException/clear are stable (useCallback'd on a fixed area string in useFormError); the wrapping object is recreated every render but isn't read here.
  }, [riskCode, title, category, likelihood, impact, owner, router]);

  return (
    <>
      <Button onClick={() => setOpen(true)}>+ Add Risk</Button>
      {open && (
        <div role="dialog" aria-modal="true" aria-labelledby={titleId}
          style={{ position: "fixed", inset: 0, background: "rgba(16,24,40,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }}>
          <div className="card" style={{ width: "min(520px,100%)", maxHeight: "90vh", overflowY: "auto" }}>
            <div className="card-h"><h3 id={titleId}>Add risk</h3></div>
            <div className="pad" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label className="lbl" htmlFor="rk-code">Risk code</label>
              <input id="rk-code" className="inp" value={riskCode} onChange={(e) => setRiskCode(e.target.value)} placeholder="RISK-2026-007" />
              {formError.fieldError("riskCode") && (
                <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("riskCode")}</span>
              )}
              <label className="lbl" htmlFor="rk-title">Title</label>
              <input id="rk-title" className="inp" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Vendor concentration in payments" />
              {formError.fieldError("title") && (
                <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("title")}</span>
              )}
              <label className="lbl" htmlFor="rk-cat">Category</label>
              <select id="rk-cat" className="inp" value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
                {CATEGORY.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label className="lbl" htmlFor="rk-like">Likelihood</label>
                  <select id="rk-like" className="inp" value={likelihood} onChange={(e) => setLikelihood(e.target.value as typeof likelihood)}>
                    {LIKELIHOOD.map((l) => <option key={l} value={l}>{l.replace("_", " ")}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label className="lbl" htmlFor="rk-imp">Impact</label>
                  <select id="rk-imp" className="inp" value={impact} onChange={(e) => setImpact(e.target.value as typeof impact)}>
                    {IMPACT.map((i) => <option key={i} value={i}>{i}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ fontSize: 12, color: "#667085", marginTop: 2 }}>Risk score is computed server-side from likelihood × impact.</div>
              <label className="lbl" htmlFor="rk-owner">Owner (optional)</label>
              <input id="rk-owner" className="inp" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="CFO Office" />
              {error && <div role="alert" style={{ color: "var(--bad)", fontSize: 13, marginTop: 4 }}>{error}</div>}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
                <Button variant="ghost" onClick={close} disabled={busy}>Cancel</Button>
                <Button onClick={() => void submit()} disabled={busy}>{busy ? "Adding…" : "Add risk"}</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
