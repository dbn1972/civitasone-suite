"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormError } from "@/lib/useFormError";
import { Button, ConfirmDialog, Modal } from "@/app/_components/ds";
import { useAuditT } from "@/lib/audit/useAuditT";
import { riskScore, band, BAND_LABEL, LIKELIHOOD_LABEL, IMPACT_LABEL, CATEGORY_LABEL } from "@/lib/audit/riskScoring";

const LIKELIHOOD = ["rare", "unlikely", "possible", "likely", "almost_certain"] as const;
const IMPACT = ["negligible", "minor", "moderate", "major", "catastrophic"] as const;
const CATEGORY = ["financial", "operational", "compliance", "reputational", "strategic", "it"] as const;

export function AddRiskButton() {
  const router = useRouter();
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
  const t = useAuditT();
  // GAP-AUDIT-RISK-REGISTER-04: confirm gate summarising the risk before the create mutation.
  const [confirmOpen, setConfirmOpen] = useState(false);

  const close = useCallback(() => { if (!busy) { setOpen(false); setError(null); } }, [busy]);

  const handleProceed = useCallback(() => {
    setError(null);
    if (!riskCode.trim() || !title.trim()) { setError("Risk code and title are required."); return; }
    setConfirmOpen(true);
  }, [riskCode, title]);

  const submit = useCallback(async () => {
    setError(null);
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
      setConfirmOpen(false);
      setOpen(false);
      router.refresh();
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
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
      {/* SF-19: ds/Modal (focus trap, inert background, Escape). Overlay click never discards typed input. */}
      <Modal open={open} onClose={() => { if (!confirmOpen) close(); }} title="Add risk" size="lg" closeOnOverlayClick={false}>
          <div style={{ maxHeight: "70vh", overflowY: "auto" }}>
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
                {CATEGORY.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c] ?? c}</option>)}
              </select>
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label className="lbl" htmlFor="rk-like">Likelihood</label>
                  <select id="rk-like" className="inp" value={likelihood} onChange={(e) => setLikelihood(e.target.value as typeof likelihood)}>
                    {LIKELIHOOD.map((l) => <option key={l} value={l}>{LIKELIHOOD_LABEL[l]}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label className="lbl" htmlFor="rk-imp">Impact</label>
                  <select id="rk-imp" className="inp" value={impact} onChange={(e) => setImpact(e.target.value as typeof impact)}>
                    {IMPACT.map((i) => <option key={i} value={i}>{IMPACT_LABEL[i]}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ fontSize: 13, color: "#344054", marginTop: 2 }} aria-live="polite">
                Risk score (likelihood × impact): <strong>{riskScore(likelihood, impact)}</strong> — {BAND_LABEL[band(riskScore(likelihood, impact))]}
                <span style={{ color: "#667085" }}>. Recomputed and stored server-side.</span>
              </div>
              <label className="lbl" htmlFor="rk-owner">Owner (optional)</label>
              <input id="rk-owner" className="inp" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="CFO Office" />
              {error && <div role="alert" style={{ color: "var(--bad)", fontSize: 13, marginTop: 4 }}>{error}</div>}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
                <Button variant="ghost" onClick={close} disabled={busy}>Cancel</Button>
                <Button onClick={handleProceed} disabled={busy}>{busy ? "Adding…" : "Add risk"}</Button>
              </div>
            </div>
          </div>
      </Modal>
      <ConfirmDialog
        open={confirmOpen}
        title={t("riskConfirmTitle", { riskCode: riskCode.trim() })}
        description={t("riskConfirmDescription", {
          title: title.trim(),
          category: CATEGORY_LABEL[category] ?? category,
          score: riskScore(likelihood, impact),
          band: BAND_LABEL[band(riskScore(likelihood, impact))],
        })}
        confirmLabel={t("riskConfirmLabel")}
        cancelLabel={t("cancel")}
        busy={busy}
        errorMessage={error ?? undefined}
        onConfirm={() => void submit()}
        onCancel={() => { if (!busy) setConfirmOpen(false); }}
      />
    </>
  );
}
