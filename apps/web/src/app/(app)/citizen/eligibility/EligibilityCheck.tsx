"use client";

import { userFacingErrorFromResponse } from "@/lib/api/userFacingFromResponse";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/app/_components/ds";

const inputStyle = { width: "100%", padding: 8, minHeight: 44, marginBottom: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

export interface EligibilityServiceOption { id: string; name: string }
interface Reason { ruleId: string; passed: boolean; message: string }
interface Result { outcome: string; reasons: Reason[]; reviewStatus?: string; id?: string; correlationId?: string }

/** SVC-083 — run an eligibility check against a published rule set. */
export function EligibilityCheck({ services }: { services: EligibilityServiceOption[] }) {
  const t = useTranslations("citizenEligibility");
  const [serviceId, setServiceId] = useState("");
  // GAP-CITIZEN-ELIGIBILITY-01: start empty, no prefilled sample attributes.
  const [subject, setSubject] = useState("{}");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);

  const jsonValid = useMemo(() => {
    try { JSON.parse(subject); return true; } catch { return false; }
  }, [subject]);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(""); setResult(null);
    try {
      let parsed: unknown = {};
      try { parsed = JSON.parse(subject); } catch { throw new Error(t("invalidJson")); }
      const res = await fetch("/api/proxy/v1/citizen/eligibility/evaluate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ serviceId, subject: parsed }),
      });
      if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
      setResult((await res.json()) as Result);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("evaluationFailed"));
    } finally {
      setBusy(false);
    }
  }

  function outcomeLabel(outcome: string): string {
    switch (outcome) {
      case "eligible": return t("outcomeEligible");
      case "not_eligible": return t("outcomeNotEligible");
      case "refer_manual": return t("outcomeReferManual");
      default: return outcome;
    }
  }

  const badge = result
    ? result.outcome === "eligible" ? "var(--good-bg, #ecfdf3)"
      : result.outcome === "not_eligible" ? "var(--bad-bg, #fef3f2)" : "var(--warn-bg, #fffaeb)"
    : "";
  const reference = result?.id ?? result?.correlationId ?? null;

  return (
    <div className="card">
      <form onSubmit={run} className="pad" style={{ maxWidth: 620 }}>
        <h4 style={{ marginTop: 0 }}>{t("formTitle")}</h4>

        {/* GAP-CITIZEN-ELIGIBILITY-01: service chosen by name, not a raw UUID. */}
        <label htmlFor="elig-service" style={labelStyle}>{t("serviceLabel")}</label>
        <select id="elig-service" value={serviceId} onChange={(e) => setServiceId(e.target.value)} style={inputStyle}>
          <option value="">{t("servicePlaceholder")}</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        {services.length === 0 ? <p style={{ fontSize: 12, color: "var(--muted)" }}>{t("serviceLoadError")}</p> : null}

        <label htmlFor="elig-subject" style={labelStyle}>{t("subjectLabel")}</label>
        <textarea
          id="elig-subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          aria-describedby="elig-subject-hint"
          style={{ ...inputStyle, minHeight: 120, fontFamily: "monospace" }}
        />
        <p id="elig-subject-hint" style={{ fontSize: 12, color: "var(--muted)", marginTop: -4, marginBottom: 8 }}>{t("subjectHint")}</p>

        <Button type="submit" variant="primary" style={{ minHeight: 44 }} disabled={busy || !serviceId || !jsonValid}>
          {busy ? t("checking") : t("runCheck")}
        </Button>
        {error ? <p role="alert" style={{ color: "var(--bad, #b42318)", fontSize: 13 }}>{error}</p> : null}
      </form>

      {result ? (
        <div className="pad" style={{ borderTop: "1px solid var(--line)" }}>
          <div style={{ display: "inline-block", padding: "4px 12px", borderRadius: 999, background: badge, fontWeight: 600 }}>
            {t("outcomeLabel")}: {outcomeLabel(result.outcome)}
            {result.reviewStatus === "pending" ? ` (${t("manualReviewQueued")})` : ""}
          </div>
          {reference ? (
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>{t("referenceLabel")}: {reference}</div>
          ) : null}
          <ul style={{ marginTop: 12, fontSize: 13, listStyle: "none", padding: 0 }}>
            {result.reasons.map((r) => (
              <li key={r.ruleId} style={{ color: r.passed ? "var(--good, #067647)" : "var(--bad, #b42318)", padding: "2px 0" }}>
                <strong>{r.passed ? `✔ ${t("rulePassed")}` : `✗ ${t("ruleFailed")}`}</strong> — {r.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
