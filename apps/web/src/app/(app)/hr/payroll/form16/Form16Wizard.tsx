"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/app/_components/ds";

// Stable, untranslated identifiers -- only used for React keys / field ids /
// dropdown key-lookup, never displayed. Display labels are resolved via
// DEDUCTION_LABEL_KEYS + t() inside the component (UX-017).
const DEDUCTION_SECTIONS = ["12B", "80C", "80D", "80E", "80G", "24B", "10HRA"] as const;
type DeductionSection = (typeof DEDUCTION_SECTIONS)[number];
const DEDUCTION_LABEL_KEYS: Record<DeductionSection, string> = {
  "12B": "deduction12b",
  "80C": "deduction80c",
  "80D": "deduction80d",
  "80E": "deduction80e",
  "80G": "deduction80g",
  "24B": "deduction24b",
  "10HRA": "deductionHra",
};

function StepBar({ step, steps, ariaLabel }: { step: number; steps: string[]; ariaLabel: string }) {
  return (
    <nav aria-label={ariaLabel} style={{ display: "flex", marginBottom: 28 }}>
      {steps.map((label, i) => {
        const done = i < step;
        const active = i === step;
        return (
          <div key={label} style={{ flex: 1, display: "flex", alignItems: "center" }}>
            <div style={{ flex: "none", display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div
                style={{
                  width: 28, height: 28, borderRadius: "50%",
                  background: done ? "var(--good, #27ae60)" : active ? "var(--accent, #2563eb)" : "var(--line2)",
                  color: done || active ? "#fff" : "var(--ink2)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 12, fontWeight: 700,
                }}
                aria-current={active ? "step" : undefined}
              >
                {done ? "✓" : i + 1}
              </div>
              <span style={{ fontSize: 11, marginTop: 4, color: active ? "var(--accent, #2563eb)" : "var(--ink2)", whiteSpace: "nowrap" }}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div style={{ flex: 1, height: 2, background: done ? "var(--good, #27ae60)" : "var(--line2)", margin: "0 6px", marginBottom: 20 }} />
            )}
          </div>
        );
      })}
    </nav>
  );
}

function TdsReconciliationTable({ fy, t }: { fy: string; t: ReturnType<typeof useTranslations> }) {
  const columnHeaders = [t("colQuarter"), t("colGrossSalary"), t("colTdsDeducted"), t("colChallanRef")];
  const quarters = [t("quarterQ1"), t("quarterQ2"), t("quarterQ3"), t("quarterQ4")];
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid var(--line2)" }}>
            {columnHeaders.map((h) => (
              <th key={h} style={{ padding: "8px 10px", textAlign: "start", fontWeight: 600, color: "var(--ink2)" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {quarters.map((q, i) => (
            <tr key={q} style={{ borderBottom: "1px solid var(--line2)" }}>
              <td style={{ padding: "8px 10px" }}>{q}</td>
              <td style={{ padding: "8px 10px", textAlign: "end", color: "var(--ink2)" }}>—</td>
              <td style={{ padding: "8px 10px", textAlign: "end", color: "var(--ink2)" }}>—</td>
              <td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: 12, color: "var(--ink2)" }}>
                CHLN-FY{fy.replace("-", "")}-Q{i + 1}
              </td>
            </tr>
          ))}
          <tr style={{ borderTop: "2px solid var(--line2)", background: "var(--panel)" }}>
            <td style={{ padding: "8px 10px", fontWeight: 700 }}>{t("annualTotal")}</td>
            <td style={{ padding: "8px 10px", textAlign: "end", fontWeight: 700 }}>—</td>
            <td style={{ padding: "8px 10px", textAlign: "end", fontWeight: 700 }}>—</td>
            <td style={{ padding: "8px 10px" }} />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function Form16Wizard({ defaultFy }: { defaultFy: string }) {
  const t = useTranslations("form16Wizard");
  const [step, setStep] = useState(0);
  const [fy, setFy] = useState(defaultFy);
  const [employeeId, setEmployeeId] = useState("");
  const DEDUCTIONS = DEDUCTION_SECTIONS.map((section) => ({ section, label: t(DEDUCTION_LABEL_KEYS[section]) }));
  const [deductionVals, setDeductionVals] = useState<Record<string, string>>(
    Object.fromEntries(DEDUCTION_SECTIONS.map((section) => [section, ""])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [jobId, setJobId] = useState<string | null>(null);

  const fyId = useId();
  const empId = useId();

  const STEP_NAMES = useMemo(
    () => [t("stepSelectFy"), t("stepReviewDeductions"), t("stepGenerateDownload")],
    [t],
  );

  // Focus management + step-change announcement (WCAG 2.4.3 / 4.1.3): moving
  // between steps today re-renders in place with nothing to tell a keyboard
  // or screen-reader user the step actually changed. On every step change
  // (not the initial mount — that would steal focus from normal page load)
  // move focus to the new step's panel and announce it via a polite live
  // region, a standard low-risk wizard pattern.
  const panelRef = useRef<HTMLDivElement>(null);
  const [announcement, setAnnouncement] = useState("");
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    panelRef.current?.focus();
    setAnnouncement(
      t("stepProgress", { current: step + 1, total: STEP_NAMES.length, name: STEP_NAMES[step] ?? "" }),
    );
  }, [step, t, STEP_NAMES]);

  async function generateForm16() {
    setBusy(true);
    setError(undefined);
    try {
      const body: Record<string, unknown> = { fy };
      if (employeeId.trim()) body.employeeIds = [employeeId.trim()];
      const res = await fetch("/api/proxy/v1/payroll/tax/form16/bulk-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: { message?: string } };
        setError(d?.error?.message ?? t("generationFailedDefault"));
        return;
      }
      const d = await res.json().catch(() => ({})) as { data?: { jobId?: string } };
      setJobId(d?.data?.jobId ?? null);
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("networkErrorDefault"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: "20px 24px" }}>
      <StepBar step={step} steps={STEP_NAMES} ariaLabel={t("stepAriaLabel")} />
      {/* Announces "Step 2 of 3: Review Deductions" etc. whenever `step`
          changes — sighted keyboard users get the same cue visually via
          StepBar's aria-current="step" circle, but that's silent to a
          screen reader unless something explicitly speaks the change. */}
      <div aria-live="polite" className="sr-only">{announcement}</div>

      {/* Step 0 — Select FY */}
      {step === 0 && (
        <div ref={panelRef} tabIndex={-1} role="group" aria-label={STEP_NAMES[0] ?? ""} style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, maxWidth: 500 }}>
            <div>
              <label htmlFor={fyId} style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>{t("financialYearLabel")}</label>
              <input id={fyId} type="text" className="input" value={fy} onChange={(e) => setFy(e.target.value)} placeholder="2024-25" />
              <p style={{ fontSize: 11, color: "var(--ink2)", marginTop: 4 }}>{t("financialYearFormatHint")}</p>
            </div>
            <div>
              <label htmlFor={empId} style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>
                {t("employeeIdLabel")} <span style={{ color: "var(--ink2)", fontWeight: 400 }}>{t("employeeIdOptional")}</span>
              </label>
              <input id={empId} type="text" className="input" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} placeholder={t("employeeIdPlaceholder")} />
            </div>
          </div>
          <div>
            <Button onClick={() => setStep(1)}>{t("nextBtn")}</Button>
          </div>
        </div>
      )}

      {/* Step 1 — Review deductions + TDS reconciliation */}
      {step === 1 && (
        <div ref={panelRef} tabIndex={-1} role="group" aria-label={STEP_NAMES[1] ?? ""} style={{ display: "grid", gap: 22 }}>
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>{t("deductionFiguresHeading", { fy })}</h3>
            <div style={{ display: "grid", gap: 8, maxWidth: 540 }}>
              {DEDUCTIONS.map((d) => (
                <div key={d.section} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "center" }}>
                  <label htmlFor={`f16-deduction-${d.section}`} style={{ fontSize: 13, color: "var(--ink2)" }}>{d.label}</label>
                  <input
                    id={`f16-deduction-${d.section}`}
                    type="number"
                    className="input"
                    style={{ width: 160, textAlign: "end" }}
                    value={deductionVals[d.section] ?? ""}
                    onChange={(e) => setDeductionVals((prev) => ({ ...prev, [d.section]: e.target.value }))}
                    placeholder="0.00"
                    min="0"
                  />
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>{t("annualTdsReconciliationHeading", { fy })}</h3>
            <p style={{ fontSize: 12, color: "var(--ink2)", marginBottom: 10 }}>{t("tdsReconciliationNote")}</p>
            <TdsReconciliationTable fy={fy} t={t} />
          </div>

          {error && <p role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 13 }}>{error}</p>}
          <div style={{ display: "flex", gap: 10 }}>
            <Button variant="ghost" onClick={() => setStep(0)}>{t("backBtn")}</Button>
            <Button onClick={() => void generateForm16()} disabled={busy} loading={busy}>
              {busy ? t("generatingBtn") : t("generateBtn")}
            </Button>
          </div>
        </div>
      )}

      {/* Step 2 — Download */}
      {step === 2 && (
        <div ref={panelRef} tabIndex={-1} role="group" aria-label={STEP_NAMES[2] ?? ""} style={{ display: "grid", gap: 16 }}>
          <div style={{ background: "var(--goodbg, #e6f7f0)", borderRadius: 12, padding: "28px", textAlign: "center" }}>
            <p style={{ fontSize: 36, margin: "0 0 10px" }}>✅</p>
            <p style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{t("generationStartedTitle")}</p>
            {jobId && <p style={{ fontSize: 13, fontFamily: "monospace", color: "var(--ink2)" }}>{t("jobIdLabel", { jobId })}</p>}
            <p style={{ fontSize: 13, color: "var(--ink2)", marginTop: 8 }}>
              {t("generationAsyncNote")}
            </p>
            <div style={{ marginTop: 16, display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              <a className="btn" href={`/api/proxy/v1/payroll/tax/form16/bulk-download?fy=${encodeURIComponent(fy)}`}>
                {t("downloadZipBtn")}
              </a>
              <Button variant="ghost" onClick={() => { setStep(0); setJobId(null); setError(undefined); }}>
                {t("generateAnotherBtn")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
