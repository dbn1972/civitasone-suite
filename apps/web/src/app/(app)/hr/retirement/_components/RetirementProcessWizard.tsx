"use client";
/**
 * RetirementProcessWizard — Sprint 14 / Lifecycle Phase 2
 * 5-step interactive checklist wizard for processing a retirement:
 * NOC from Departments → Final Pay Certificate → GPF/NPS Settlement →
 * Gratuity Calculation → Pension Order Generation.
 * Pure client-side step tracker — no API mutation in Phase 2.
 */
import { useState } from "react";

const STEPS = [
  {
    id: 1,
    icon: "🏢",
    title: "NOC from Departments",
    subtitle:
      "Obtain No-Objection Certificates from all holding departments before last working day.",
    checks: [
      "Library clearance certificate obtained",
      "Store / Equipment / Furniture clearance obtained",
      "IT / Laptop / Mobile / SIM card assets returned and cleared",
      "Finance / TA advance / LTC advance adjusted and cleared",
      "Official accommodation / government quarters vacated (if applicable)",
    ],
  },
  {
    id: 2,
    icon: "📄",
    title: "Final Pay Certificate",
    subtitle:
      "Generate FPC for last drawn pay, leave encashment, and all pending dues.",
    checks: [
      "Last working day officially confirmed",
      "Leave encashment computed (max 300 days EL per Rule 39 CCS Leave Rules)",
      "Salary arrears / increment due cleared",
      "LTC advance / HBA advance fully adjusted",
      "Final Pay Certificate (Form-9) issued and signed by DDO",
    ],
  },
  {
    id: 3,
    icon: "🏦",
    title: "GPF / NPS Settlement",
    subtitle:
      "Close the GPF account or initiate NPS exit as applicable for the retiree.",
    checks: [
      "GPF final balance verified with Pay & Accounts Office (PAO)",
      "Nomination details confirmed in GPF records",
      "GPF withdrawal application (Form-G / 7D) submitted to PAO",
      "NPS subscriber ID closure notified to PFRDA (for NPS optees)",
      "Final settlement amount credited to nominee / beneficiary account",
    ],
  },
  {
    id: 4,
    icon: "💰",
    title: "Gratuity Calculation",
    subtitle:
      "Compute DCRG (Death-cum-Retirement Gratuity) under CCS (Pension) Rules, 2021.",
    checks: [
      "Qualifying service (QS) years verified from service book",
      "Last pay drawn (emoluments) confirmed from FPC",
      "DCRG computed: Emoluments × ½ × QS (max ₹25 lakh w.e.f. 01.01.2024)",
      "Gratuity claim Form-6 submitted to PAO with service book",
      "Sanction order for DCRG issued by PAO and copy sent to retiree",
    ],
  },
  {
    id: 5,
    icon: "📜",
    title: "Pension Order (PPO)",
    subtitle:
      "Issue Pension Payment Order and forward to CPPC / Treasury / Bank.",
    checks: [
      "Pension computation sheet (emoluments, QS, commutation) prepared",
      "Pension application Form-5 with forwarding letter signed by HoO",
      "PPO generated in Bhavishya / SPARSH and verified",
      "PPO along with Form-14 forwarded to CPPC / nominated bank branch",
      "Acknowledgement of PPO receipt obtained from CPPC",
    ],
  },
] as const;

type CheckedState = Record<number, Record<number, boolean>>;

interface Props {
  employeeName?: string;
}

export function RetirementProcessWizard({ employeeName }: Props) {
  const [activeStep, setActiveStep] = useState(0);
  const [checked, setChecked] = useState<CheckedState>({});

  function toggle(si: number, ci: number) {
    setChecked((prev) => ({
      ...prev,
      [si]: { ...(prev[si] ?? {}), [ci]: !(prev[si]?.[ci] ?? false) },
    }));
  }

  function stepDone(si: number): boolean {
    const m = checked[si] ?? {};
    return STEPS[si].checks.every((_, ci) => m[ci] === true);
  }

  const totalChecks = STEPS.reduce((t, s) => t + s.checks.length, 0);
  const doneChecks  = Object.entries(checked).reduce(
    (t, [, cmap]) => t + Object.values(cmap).filter(Boolean).length,
    0,
  );
  const overallPct = Math.round((doneChecks / totalChecks) * 100);

  const allDone = STEPS.every((_, i) => stepDone(i));

  return (
    <div>
      {employeeName && (
        <p style={{ margin: "0 0 14px", fontSize: "0.875rem", color: "var(--ink2)" }}>
          Processing retirement for: <strong>{employeeName}</strong>
        </p>
      )}

      {/* Overall progress bar */}
      <div style={{ marginBottom: 20 }}>
        <div
          style={{
            display: "flex", justifyContent: "space-between",
            marginBottom: 6, fontSize: "0.8125rem", color: "var(--ink3)",
          }}
        >
          <span>Overall progress</span>
          <span style={{ fontWeight: 600, color: allDone ? "#16a34a" : "var(--ink)" }}>
            {overallPct}%
          </span>
        </div>
        <div
          style={{
            height: 8, background: "var(--bg2, #f1f5f9)",
            borderRadius: 99, overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              background: allDone ? "#16a34a" : "#2563eb",
              width: `${overallPct}%`,
              borderRadius: 99,
              transition: "width 0.4s ease",
            }}
          />
        </div>
      </div>

      {/* Step tab bar */}
      <div
        role="tablist"
        aria-label="Retirement processing steps"
        style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}
      >
        {STEPS.map((step, i) => {
          const done   = stepDone(i);
          const active = i === activeStep;
          return (
            <button
              key={step.id}
              role="tab"
              aria-selected={active}
              aria-controls={`wizard-step-panel-${i}`}
              id={`wizard-step-tab-${i}`}
              onClick={() => setActiveStep(i)}
              style={{
                display: "flex", alignItems: "center", gap: 7,
                padding: "8px 14px", borderRadius: 8, border: "none",
                cursor: "pointer",
                background: active
                  ? "var(--primary, #2563eb)"
                  : done
                  ? "#f0fdf4"
                  : "var(--bg2, #f1f5f9)",
                color: active ? "#fff" : done ? "#16a34a" : "var(--ink)",
                fontWeight: active ? 600 : 400,
                fontSize: "0.8125rem",
                transition: "background 0.2s, color 0.2s",
              }}
            >
              <span>{done ? "✅" : step.icon}</span>
              <span>
                {i + 1}. {step.title}
              </span>
            </button>
          );
        })}
      </div>

      {/* Active step panel */}
      {STEPS.map((step, si) => {
        if (si !== activeStep) return null;
        const stepMap      = checked[si] ?? {};
        const done         = stepDone(si);
        const completedCnt = step.checks.filter((_, ci) => stepMap[ci]).length;
        const stepPct      = Math.round((completedCnt / step.checks.length) * 100);

        return (
          <div
            key={step.id}
            id={`wizard-step-panel-${si}`}
            role="tabpanel"
            aria-labelledby={`wizard-step-tab-${si}`}
            style={{
              border: "1px solid var(--line, #e2e8f0)",
              borderRadius: 10,
              padding: 20,
              background: done ? "#f0fdf4" : "var(--bg, #fff)",
              transition: "background 0.3s",
            }}
          >
            {/* Step header */}
            <div style={{ display: "flex", gap: 14, marginBottom: 14, alignItems: "flex-start" }}>
              <div
                style={{
                  width: 48, height: 48, borderRadius: 10,
                  background: done ? "#dcfce7" : "#e6f0ff",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 24, flexShrink: 0,
                }}
              >
                {done ? "✅" : step.icon}
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>
                  Step {step.id} — {step.title}
                </h3>
                <p style={{ margin: "4px 0 0", fontSize: "0.8125rem", color: "var(--ink2)" }}>
                  {step.subtitle}
                </p>
              </div>
            </div>

            {/* Per-step progress */}
            <div style={{ marginBottom: 14 }}>
              <div
                style={{
                  height: 4, background: "var(--bg2, #f1f5f9)",
                  borderRadius: 99, overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    background: done ? "#16a34a" : "#2563eb",
                    width: `${stepPct}%`,
                    transition: "width 0.3s",
                  }}
                />
              </div>
              <p
                style={{
                  margin: "4px 0 0", fontSize: "0.75rem", color: "var(--ink3)",
                }}
              >
                {completedCnt} of {step.checks.length} tasks completed
              </p>
            </div>

            {/* Checklist */}
            <ul
              style={{
                listStyle: "none", margin: 0, padding: 0,
                display: "flex", flexDirection: "column", gap: 8,
              }}
            >
              {step.checks.map((check, ci) => {
                const isChecked = stepMap[ci] ?? false;
                return (
                  <li key={ci}>
                    <label
                      style={{
                        display: "flex", alignItems: "flex-start", gap: 12,
                        cursor: "pointer", padding: "10px 14px", borderRadius: 8,
                        background: isChecked
                          ? "#f0fdf4"
                          : "var(--bg2, #f8fafc)",
                        transition: "background 0.2s",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggle(si, ci)}
                        style={{ marginTop: 2, flexShrink: 0, accentColor: "#16a34a" }}
                        aria-label={check}
                      />
                      <span
                        style={{
                          fontSize: "0.875rem",
                          color: isChecked ? "#16a34a" : "var(--ink)",
                          textDecoration: isChecked ? "line-through" : "none",
                          transition: "color 0.2s, text-decoration 0.2s",
                        }}
                      >
                        {check}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>

            {/* Navigation */}
            <div
              style={{
                display: "flex", justifyContent: "space-between",
                alignItems: "center", marginTop: 20, gap: 8,
              }}
            >
              <button
                onClick={() => setActiveStep(Math.max(0, si - 1))}
                disabled={si === 0}
                style={{
                  padding: "8px 20px", borderRadius: 6,
                  border: "1px solid var(--line)",
                  background: "transparent",
                  cursor: si === 0 ? "not-allowed" : "pointer",
                  opacity: si === 0 ? 0.4 : 1,
                  fontSize: "0.875rem", color: "var(--ink)",
                }}
              >
                ← Previous
              </button>
              {si < STEPS.length - 1 ? (
                <button
                  onClick={() => setActiveStep(si + 1)}
                  style={{
                    padding: "8px 20px", borderRadius: 6, border: "none",
                    background: "var(--primary, #2563eb)", color: "#fff",
                    cursor: "pointer", fontSize: "0.875rem", fontWeight: 500,
                  }}
                >
                  Next Step →
                </button>
              ) : allDone ? (
                <span
                  style={{
                    padding: "8px 20px", borderRadius: 6,
                    background: "#16a34a", color: "#fff",
                    fontSize: "0.875rem", fontWeight: 600,
                  }}
                >
                  ✅ All Steps Complete — Issue PPO
                </span>
              ) : (
                <span
                  style={{ fontSize: "0.8125rem", color: "var(--ink3)" }}
                >
                  Complete all steps to generate PPO
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
