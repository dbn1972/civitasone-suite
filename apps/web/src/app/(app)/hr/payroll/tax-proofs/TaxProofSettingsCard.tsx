"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { browserFetch, errorCodeFromResponse } from "@/lib/api/browserClient";
import { errorKeyForCode, isValidCutoffMd, isValidFy, type RetentionSettings } from "@/lib/payroll/taxProofs";
import { Button } from "../../../../_components/ds";

const NO_MESSAGE: { text: string; tone: "good" | "bad" } | null = null;

/**
 * GAP-PAYROLL-TAX-DECLARATION-02: the tenant's retention period for
 * investment-proof files (whole years from the END of the financial year).
 * payroll_admin / tenant_admin / super_admin may change it; every change is
 * audited with before and after. A legal hold (set per proof in the queue)
 * always overrides it.
 */
export function TaxProofSettingsCard() {
  const t = useTranslations("taxProofs");
  const yearsId = useId();
  const reasonId = useId();
  const cutoffId = useId();
  const fromId = useId();
  const [cutoff, setCutoff] = useState("");
  const [verifiedFrom, setVerifiedFrom] = useState("");
  const [settings, setSettings] = useState<RetentionSettings | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [years, setYears] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(NO_MESSAGE);

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const res = await browserFetch("v1/payroll/tax-proofs/settings");
      if (!res.ok) {
        setLoadFailed(true);
        return;
      }
      const s = (await res.json()) as RetentionSettings;
      setSettings(s);
      setYears(String(s.taxProofRetentionYears));
      setCutoff(s.taxProofCutoff);
      setVerifiedFrom(s.taxProofVerifiedFromFy ?? "");
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setMessage(null);
    const n = Number(years);
    if (!Number.isInteger(n) || n < settings.minYears || n > settings.maxYears) {
      setMessage({ text: t("settings.invalidYears", { min: settings.minYears, max: settings.maxYears }), tone: "bad" });
      return;
    }
    const cutoffChanged = settings.canEditCutoff && cutoff !== settings.taxProofCutoff;
    if (cutoffChanged && !isValidCutoffMd(cutoff)) {
      setMessage({ text: t("settings.invalidCutoff"), tone: "bad" });
      return;
    }
    const fromChanged = settings.canEditVerifiedFrom && verifiedFrom.trim() !== (settings.taxProofVerifiedFromFy ?? "");
    if (fromChanged && verifiedFrom.trim() !== "" && !isValidFy(verifiedFrom.trim())) {
      setMessage({ text: t("settings.invalidVerifiedFrom"), tone: "bad" });
      return;
    }
    setBusy(true);
    try {
      const res = await browserFetch("v1/payroll/tax-proofs/settings", {
        method: "PUT",
        body: JSON.stringify({
          taxProofRetentionYears: n,
          ...(cutoffChanged ? { taxProofCutoff: cutoff } : {}),
          ...(fromChanged ? { taxProofVerifiedFromFy: verifiedFrom.trim() === "" ? null : verifiedFrom.trim() } : {}),
          ...(reason.trim().length >= 10 ? { reason: reason.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const key = errorKeyForCode(await errorCodeFromResponse(res));
        setMessage({ text: key ? t(`errors.${key}`) : t("errors.generic"), tone: "bad" });
        return;
      }
      setMessage({ text: t("settings.saved"), tone: "good" });
      setReason("");
      setTimeout(() => void load(), 1000);
    } catch {
      setMessage({ text: t("errors.generic"), tone: "bad" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <div className="card-h"><h3>{t("settings.heading")}</h3></div>
      <div className="pad" style={{ display: "grid", gap: 12 }}>
        {loadFailed || !settings ? (
          <div role={loadFailed ? "alert" : undefined} style={{ fontSize: 13, color: loadFailed ? "var(--bad)" : undefined, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <span>{loadFailed ? t("settings.loadFailed") : t("loading")}</span>
            {loadFailed && <Button type="button" variant="ghost" style={{ minHeight: 32 }} onClick={() => void load()}>{t("retry")}</Button>}
          </div>
        ) : (
          <form onSubmit={save} noValidate style={{ display: "grid", gap: 12 }}>
            <p style={{ fontSize: 12, color: "var(--ink2)", margin: 0 }}>{t("settings.description", { min: settings.minYears, max: settings.maxYears, def: settings.defaultYears })}</p>
            <p style={{ fontSize: 12, color: "var(--ink2)", margin: 0 }}>{t("settings.verifyNote")}</p>
            <div style={{ display: "grid", gap: 6, maxWidth: 220 }}>
              <label htmlFor={yearsId} style={{ fontSize: 13, fontWeight: 600 }}>{t("settings.yearsLabel")}</label>
              <input
                id={yearsId}
                type="number"
                min={settings.minYears}
                max={settings.maxYears}
                step={1}
                value={years}
                disabled={!settings.canEdit || busy}
                onChange={(e) => setYears(e.target.value)}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6, maxWidth: 220 }}>
              <label htmlFor={cutoffId} style={{ fontSize: 13, fontWeight: 600 }}>{t("settings.cutoffLabel")}</label>
              <input
                id={cutoffId}
                type="text"
                inputMode="numeric"
                maxLength={5}
                placeholder="01-31"
                value={cutoff}
                disabled={!settings.canEditCutoff || busy}
                onChange={(e) => setCutoff(e.target.value)}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              <span style={{ fontSize: 12, color: "var(--ink2)" }}>
                {t("settings.cutoffHint", { date: settings.currentFyCutoffDate ?? "" })}
              </span>
            </div>
            <div style={{ display: "grid", gap: 6, maxWidth: 360 }}>
              <label htmlFor={fromId} style={{ fontSize: 13, fontWeight: 600 }}>{t("settings.verifiedFromLabel")}</label>
              <input
                id={fromId}
                type="text"
                maxLength={7}
                placeholder="2026-27"
                value={verifiedFrom}
                disabled={!settings.canEditVerifiedFrom || busy}
                onChange={(e) => setVerifiedFrom(e.target.value)}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              <span role="note" style={{ fontSize: 12, color: "var(--warn, #b45309)" }}>{t("settings.verifiedFromWarning")}</span>
            </div>
            {settings.canEdit ? (
              <>
                <div style={{ display: "grid", gap: 6, maxWidth: 420 }}>
                  <label htmlFor={reasonId} style={{ fontSize: 13, fontWeight: 600 }}>{t("settings.reasonLabel")}</label>
                  <input
                    id={reasonId}
                    type="text"
                    maxLength={500}
                    value={reason}
                    disabled={busy}
                    onChange={(e) => setReason(e.target.value)}
                    style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
                  />
                </div>
                <div><Button type="submit" style={{ minHeight: 44 }} disabled={busy}>{busy ? t("settings.saving") : t("settings.saveBtn")}</Button></div>
              </>
            ) : (
              <p style={{ fontSize: 12, color: "var(--ink2)", margin: 0 }}>{t("settings.readOnly")}</p>
            )}
            {message && <p role="status" aria-live="polite" className={`pill ${message.tone}`} style={{ width: "fit-content", margin: 0 }}>{message.text}</p>}
          </form>
        )}
      </div>
    </section>
  );
}
