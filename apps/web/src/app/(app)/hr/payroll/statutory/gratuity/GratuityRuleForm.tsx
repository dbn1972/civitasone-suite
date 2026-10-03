"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card } from "../../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { rupeesToMinorString } from "@/lib/money";
import type { GratuityRuleSet } from "./gratuityEstimate";

/**
 * GAP-PAYROLL-STATUTORY-GRATUITY-01/04: payroll_admin / super_admin pick the
 * gratuity rule set for the tenant (Payment of Gratuity Act for PSU / small
 * office, CCS (Pension) Rules DCRG for a Government Department) and the
 * ceiling. POST /v1/payroll/statutory/gratuity/rules is effective-dated and
 * audited with a reason; the ceiling pre-fills are VERIFY values.
 */
const SUGGESTED: Record<GratuityRuleSet, { ceilingRupees: string; minYears: string }> = {
  pog_act: { ceilingRupees: "2000000", minYears: "5" },
  ccs_dcrg: { ceilingRupees: "2500000", minYears: "5" },
};

export function GratuityRuleForm({ currentRuleSet }: { currentRuleSet: GratuityRuleSet }) {
  const t = useTranslations("gratuityRuleForm");
  const router = useRouter();
  const [ruleSet, setRuleSet] = useState<GratuityRuleSet>(currentRuleSet);
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [minYears, setMinYears] = useState(SUGGESTED[currentRuleSet].minYears);
  const [ceiling, setCeiling] = useState(SUGGESTED[currentRuleSet].ceilingRupees);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const ids = { rs: useId(), eff: useId(), min: useId(), cap: useId(), why: useId() };

  function pickRuleSet(next: GratuityRuleSet) {
    setRuleSet(next);
    setMinYears(SUGGESTED[next].minYears);
    setCeiling(SUGGESTED[next].ceilingRupees);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const ceilingMinor = rupeesToMinorString(ceiling.replace(/,/g, "").trim(), { allowZero: true });
    const years = Number(minYears);
    if (ceilingMinor === null || !Number.isInteger(years) || years < 0 || years > 40 || !effectiveFrom || reason.trim().length < 10) {
      setMessage({ tone: "bad", text: t("invalid") });
      return;
    }
    setBusy(true);
    try {
      await browserJson("v1/payroll/statutory/gratuity/rules", {
        method: "POST",
        body: JSON.stringify({ effectiveFrom, ruleSet, minServiceYears: years, ceilingMinor, changeReason: reason.trim() }),
      });
      setMessage({ tone: "good", text: t("saved") });
      setReason("");
      router.refresh();
    } catch (err) {
      setMessage({ tone: "bad", text: err instanceof Error ? err.message : t("failed") });
    } finally {
      setBusy(false);
    }
  }

  const field = { padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 } as const;
  return (
    <form onSubmit={submit} noValidate style={{ marginBottom: 16 }}>
      <Card title={t("title")} padding>
        <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--mut)" }}>{t("verifyNote")}</p>
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={ids.rs} style={{ fontSize: 13, fontWeight: 600 }}>{t("ruleSetLabel")}</label>
            <select id={ids.rs} value={ruleSet} onChange={(e) => pickRuleSet(e.target.value as GratuityRuleSet)} style={{ ...field, background: "#fff" }}>
              <option value="pog_act">{t("ruleSetPogAct")}</option>
              <option value="ccs_dcrg">{t("ruleSetCcsDcrg")}</option>
            </select>
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={ids.eff} style={{ fontSize: 13, fontWeight: 600 }}>{t("effectiveFromLabel")}</label>
            <input id={ids.eff} type="date" required value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} style={field} />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={ids.min} style={{ fontSize: 13, fontWeight: 600 }}>{t("minYearsLabel")}</label>
            <input id={ids.min} type="number" min="0" max="40" step="1" value={minYears} onChange={(e) => setMinYears(e.target.value)} style={field} />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={ids.cap} style={{ fontSize: 13, fontWeight: 600 }}>{t("ceilingLabel")}</label>
            <input id={ids.cap} inputMode="decimal" value={ceiling} onChange={(e) => setCeiling(e.target.value)} style={field} />
          </div>
        </div>
        <div style={{ display: "grid", gap: 6, marginTop: 14 }}>
          <label htmlFor={ids.why} style={{ fontSize: 13, fontWeight: 600 }}>{t("reasonLabel")}</label>
          <input id={ids.why} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} style={field} />
        </div>
        <div style={{ marginTop: 14 }}>
          <Button type="submit" style={{ minHeight: 44 }} disabled={busy}>{t("submit")}</Button>
        </div>
        {message && (
          <p role={message.tone === "bad" ? "alert" : "status"} className={`pill ${message.tone}`} style={{ width: "fit-content", marginTop: 12 }}>
            {message.text}
          </p>
        )}
      </Card>
    </form>
  );
}
