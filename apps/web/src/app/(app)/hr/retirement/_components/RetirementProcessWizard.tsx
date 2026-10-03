"use client";
/**
 * RetirementProcessWizard — Sprint 14 / Lifecycle Phase 2
 * 5-step interactive checklist wizard for processing a retirement:
 * NOC from Departments → Final Pay Certificate → GPF/NPS Settlement →
 * Gratuity Calculation → Pension Order Generation.
 *
 * GAP-HR-RETIREMENT-01: now backed by GET/PUT /v1/hrms/separations/:id/checklist
 * and POST .../issue-ppo (see lifecycle/routes.ts) -- previously pure
 * client-side useState with no persistence at all, and "Issue PPO" was a
 * styled <span>, not a working action.
 */
import { UserFacingError } from "@/lib/userFacingError";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { Button, ConfirmDialog, useToast } from "@/app/_components/ds";

const STEP_IDS = ["1", "2", "3", "4", "5"] as const;
const STEP_ICONS = ["🏢", "📄", "🏦", "💰", "📜"];
const CHECKS_PER_STEP = 5;
const TOTAL_CHECKS = STEP_IDS.length * CHECKS_PER_STEP;

type ChecklistState = Record<string, Record<number, boolean>>;

interface Props {
  employeeName?: string;
  /** The hrms_separations row id this wizard tracks. Undefined until a
   * retiree is selected (see RetirementCaseWorkspace). */
  separationId?: string;
}

export function RetirementProcessWizard({ employeeName, separationId }: Props) {
  const t = useTranslations("retirementWizard");
  const { toast } = useToast();

  const steps = STEP_IDS.map((id, i) => ({
    id,
    icon: STEP_ICONS[i],
    title: t(`step${id}Title`),
    subtitle: t(`step${id}Subtitle`),
    checks: Array.from({ length: CHECKS_PER_STEP }, (_, ci) => t(`step${id}Check${ci}`)),
  }));

  const formError = useFormError("retirement checklist");
  const [activeStep, setActiveStep] = useState(0);
  const [checked, setChecked] = useState<ChecklistState>({});
  const [ppoIssuedAt, setPpoIssuedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    setActiveStep(0);
    if (!separationId) {
      setChecked({});
      setPpoIssuedAt(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch(`/api/proxy/v1/hrms/separations/${separationId}/checklist`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const body = (await res.json()) as {
          data: Array<{ stepId: string; checkIndex: number; done: boolean }>;
          ppoIssuedAt?: string | null;
        };
        const next: ChecklistState = {};
        for (const row of body.data) {
          next[row.stepId] = { ...(next[row.stepId] ?? {}), [row.checkIndex]: row.done };
        }
        setChecked(next);
        setPpoIssuedAt(body.ppoIssuedAt ?? null);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
      } finally {
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [separationId]);

  const readOnly = Boolean(ppoIssuedAt);

  async function toggle(stepId: string, checkIndex: number) {
    if (!separationId || readOnly) return;
    const prevValue = checked[stepId]?.[checkIndex] ?? false;
    const nextValue = !prevValue;
    // Optimistic update, rolled back on a failed PUT.
    setChecked((prev) => ({ ...prev, [stepId]: { ...(prev[stepId] ?? {}), [checkIndex]: nextValue } }));
    try {
      const res = await fetch(`/api/proxy/v1/hrms/separations/${separationId}/checklist`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stepId, checkIndex, done: nextValue }),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        throw UserFacingError.from(resolved);
      }
    } catch {
      setChecked((prev) => ({ ...prev, [stepId]: { ...(prev[stepId] ?? {}), [checkIndex]: prevValue } }));
      toast.error(t("toggleErrorToast"));
    }
  }

  async function confirmIssuePpo() {
    if (!separationId) return;
    setIssuing(true);
    try {
      const res = await fetch(`/api/proxy/v1/hrms/separations/${separationId}/issue-ppo`, { method: "POST" });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        throw UserFacingError.from(resolved);
      }
      setPpoIssuedAt(new Date().toISOString());
      setConfirmOpen(false);
      toast.success(t("ppoIssuedToast"));
    } catch {
      toast.error(t("issuePpoErrorToast"));
    } finally {
      setIssuing(false);
    }
  }

  function stepDone(si: number): boolean {
    const m = checked[steps[si].id] ?? {};
    return steps[si].checks.every((_, ci) => m[ci] === true);
  }

  const doneChecks = STEP_IDS.reduce(
    (t2, id) => t2 + Object.values(checked[id] ?? {}).filter(Boolean).length,
    0,
  );
  const overallPct = Math.round((doneChecks / TOTAL_CHECKS) * 100);
  const allDone = steps.every((_, i) => stepDone(i));

  return (
    <div>
      {employeeName ? (
        <p style={{ margin: "0 0 10px", fontSize: "0.875rem", color: "var(--ink2)" }}>
          {t("processingFor", { name: employeeName })}
        </p>
      ) : (
        <p style={{ margin: "0 0 10px", fontSize: "0.875rem", color: "var(--ink2)" }}>{t("noRetireeSelected")}</p>
      )}

      {readOnly && (
        <div
          role="status"
          style={{
            display: "flex", gap: 8, alignItems: "flex-start",
            padding: "10px 14px", marginBottom: 16, borderRadius: 8,
            background: "var(--goodbg, #f0fdf4)", border: "1px solid var(--goodbd, #bbf7d0)",
            fontSize: "0.8125rem", color: "var(--good, #16a34a)",
          }}
        >
          <span aria-hidden="true">✅</span>
          <span>{t("ppoIssuedNotice", { date: new Date(ppoIssuedAt as string).toLocaleDateString("en-IN") })}</span>
        </div>
      )}

      {/* Overall progress bar */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: "0.8125rem", color: "var(--mut)" }}>
          <span>{t("overallProgress")}</span>
          <span style={{ fontWeight: 600, color: allDone ? "var(--good, #16a34a)" : "var(--ink)" }}>{overallPct}%</span>
        </div>
        <div style={{ height: 8, background: "var(--bg2, #f1f5f9)", borderRadius: 99, overflow: "hidden" }}>
          <div
            style={{
              height: "100%",
              background: allDone ? "var(--good, #16a34a)" : "#2563eb",
              width: `${overallPct}%`,
              borderRadius: 99,
              transition: "width 0.4s ease",
            }}
          />
        </div>
      </div>

      {/* Step tab bar */}
      <div role="tablist" aria-label={t("stepTabsAriaLabel")} style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {steps.map((step, i) => {
          const done = stepDone(i);
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
                padding: "8px 14px", borderRadius: 8, border: "none", cursor: "pointer",
                background: active ? "var(--primary, #2563eb)" : done ? "var(--goodbg, #f0fdf4)" : "var(--bg2, #f1f5f9)",
                color: active ? "var(--panel, #fff)" : done ? "var(--good, #16a34a)" : "var(--ink)",
                fontWeight: active ? 600 : 400,
                fontSize: "0.8125rem",
                transition: "background 0.2s, color 0.2s",
              }}
            >
              <span aria-hidden="true">{done ? "✅" : step.icon}</span>
              <span>{i + 1}. {step.title}</span>
            </button>
          );
        })}
      </div>

      {/* Active step panel */}
      {steps.map((step, si) => {
        if (si !== activeStep) return null;
        const stepMap = checked[step.id] ?? {};
        const done = stepDone(si);
        const completedCnt = step.checks.filter((_, ci) => stepMap[ci]).length;
        const stepPct = Math.round((completedCnt / step.checks.length) * 100);

        return (
          <div
            key={step.id}
            id={`wizard-step-panel-${si}`}
            role="tabpanel"
            aria-labelledby={`wizard-step-tab-${si}`}
            style={{
              border: "1px solid var(--line, #e2e8f0)", borderRadius: 10, padding: 20,
              background: done ? "var(--goodbg, #f0fdf4)" : "var(--bg, #fff)",
              transition: "background 0.3s",
            }}
          >
            <div style={{ display: "flex", gap: 14, marginBottom: 14, alignItems: "flex-start" }}>
              <div
                aria-hidden="true"
                style={{
                  width: 48, height: 48, borderRadius: 10,
                  background: done ? "var(--goodbg, #dcfce7)" : "#e6f0ff",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 24, flexShrink: 0,
                }}
              >
                {done ? "✅" : step.icon}
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>
                  {t("stepHeading", { num: step.id, title: step.title })}
                </h3>
                <p style={{ margin: "4px 0 0", fontSize: "0.8125rem", color: "var(--ink2)" }}>{step.subtitle}</p>
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ height: 4, background: "var(--bg2, #f1f5f9)", borderRadius: 99, overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%", background: done ? "var(--good, #16a34a)" : "#2563eb",
                    width: `${stepPct}%`, transition: "width 0.3s",
                  }}
                />
              </div>
              <p style={{ margin: "4px 0 0", fontSize: "0.75rem", color: "var(--mut)" }}>
                {t("taskCompletedCount", { completed: completedCnt, total: step.checks.length })}
              </p>
            </div>

            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              {step.checks.map((check, ci) => {
                const isChecked = stepMap[ci] ?? false;
                return (
                  <li key={ci}>
                    <label
                      style={{
                        display: "flex", alignItems: "flex-start", gap: 12,
                        cursor: readOnly ? "default" : "pointer", padding: "10px 14px", borderRadius: 8,
                        background: isChecked ? "var(--goodbg, #f0fdf4)" : "var(--bg2, #f8fafc)",
                        transition: "background 0.2s",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        disabled={!separationId || readOnly || loading}
                        onChange={() => toggle(step.id, ci)}
                        style={{ marginTop: 2, flexShrink: 0, accentColor: "var(--good, #16a34a)" }}
                        aria-label={check}
                      />
                      <span
                        style={{
                          fontSize: "0.875rem",
                          color: isChecked ? "var(--good, #16a34a)" : "var(--ink)",
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

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 20, gap: 8 }}>
              <Button variant="ghost" onClick={() => setActiveStep(Math.max(0, si - 1))} disabled={si === 0}>
                {t("prevButton")}
              </Button>
              {si < steps.length - 1 ? (
                <Button onClick={() => setActiveStep(si + 1)}>{t("nextButton")}</Button>
              ) : readOnly ? (
                <span style={{ fontSize: "0.8125rem", color: "var(--good, #16a34a)", fontWeight: 600 }}>
                  {t("ppoAlreadyIssued")}
                </span>
              ) : (
                <Button onClick={() => setConfirmOpen(true)} disabled={!allDone || !separationId} variant="primary">
                  {t("issuePpoButton")}
                </Button>
              )}
            </div>
            {!readOnly && !allDone && si === steps.length - 1 && (
              <p style={{ marginTop: 10, fontSize: "0.8125rem", color: "var(--mut)" }}>{t("completeAllToGeneratePpo")}</p>
            )}
          </div>
        );
      })}

      <ConfirmDialog
        open={confirmOpen}
        title={t("issuePpoConfirmTitle")}
        description={t("issuePpoConfirmDescription")}
        confirmLabel={t("issuePpoButton")}
        busy={issuing}
        onConfirm={() => void confirmIssuePpo()}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
