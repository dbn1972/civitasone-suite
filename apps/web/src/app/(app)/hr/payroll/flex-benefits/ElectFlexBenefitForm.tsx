"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card, ConfirmDialog, Button } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";
import { rupeesToMinorString } from "@/lib/money";
import type { FlexPlan } from "./flexPlans";

/**
 * GAP-PAYROLL-FLEX-BENEFITS-01/03: the employee picks a PLAN from the list
 * (GET /v1/payroll/flex-benefits/plans) and gets one amount field per plan
 * component, each capped at the component's maximum, with a running total
 * capped at the plan budget. No hand-typed plan UUID, no free-text component
 * names, no FY to type (it is the plan's own FY). payroll-service re-checks
 * all of this server-side.
 */
type LineState = { amount: string };

export function electionProblems(
  plan: FlexPlan,
  amounts: Record<string, string>,
): { lines: Record<string, "invalid" | "overMax">; totalMinor: bigint; overBudget: boolean; anyEntered: boolean } {
  const lines: Record<string, "invalid" | "overMax"> = {};
  let totalMinor = 0n;
  let anyEntered = false;
  for (const c of plan.components) {
    const raw = (amounts[c.name] ?? "").trim();
    if (!raw) continue;
    anyEntered = true;
    const minor = rupeesToMinorString(raw, { allowZero: true });
    if (minor === null) {
      lines[c.name] = "invalid";
      continue;
    }
    if (BigInt(minor) > BigInt(c.maxMinor)) lines[c.name] = "overMax";
    totalMinor += BigInt(minor);
  }
  return { lines, totalMinor, overBudget: totalMinor > BigInt(plan.totalBudgetMinor), anyEntered };
}

export function ElectFlexBenefitForm({ plans }: { plans: FlexPlan[] }) {
  const t = useTranslations("electFlexBenefitForm");
  const router = useRouter();
  const [planId, setPlanId] = useState("");
  const [amounts, setAmounts] = useState<Record<string, LineState["amount"]>>({});
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");
  const [showErrors, setShowErrors] = useState(false);

  const planField = useId();
  const errId = useId();
  const budgetId = useId();

  const plan = plans.find((p) => p.id === planId) ?? null;
  const check = plan ? electionProblems(plan, amounts) : null;
  const hasLineProblem = !!check && Object.keys(check.lines).length > 0;
  const blocked = !plan || !check || hasLineProblem || check.overBudget || !check.anyEntered;

  function selectPlan(id: string) {
    setPlanId(id);
    setAmounts({});
    setShowErrors(false);
    setMessage(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setShowErrors(true);
    if (!plan) {
      setTone("bad");
      setMessage(t("planRequiredError"));
      document.getElementById(planField)?.focus();
      return;
    }
    if (!check || !check.anyEntered || hasLineProblem) {
      setTone("bad");
      setMessage(t("linesRequiredError"));
      return;
    }
    if (check.overBudget) {
      setTone("bad");
      setMessage(t("overBudgetError", { budget: formatMoney(plan.totalBudgetMinor) }));
      return;
    }
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function submitElection() {
    if (!plan || !check) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      const elections = plan.components
        .filter((c) => (amounts[c.name] ?? "").trim())
        .map((c) => ({ component: c.name, electedMinor: Number(rupeesToMinorString(amounts[c.name]!, { allowZero: true })) }));
      // CQRS: 202 { id, status: "accepted" } -- no `data` envelope (the old
      // `res.data.totalElectedMinor` threw on every successful submit).
      await browserJson<{ id: string; status: string }>("v1/payroll/flex-benefits/elections", {
        method: "POST",
        body: JSON.stringify({ planId: plan.id, fy: plan.fy, elections }),
      });
      setConfirmOpen(false);
      setTone("good");
      setShowErrors(false);
      setMessage(t("submittedMessage", { amount: formatMoney(check.totalMinor) }));
      setAmounts({});
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate style={{ marginBottom: 16 }}>
      <Card title={t("formTitle")} padding>
        <div style={{ display: "grid", gap: 14 }}>
          {plans.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--ink2)", margin: 0 }}>{t("noPlansMessage")}</p>
          ) : (
            <div style={{ display: "grid", gap: 6, maxWidth: 420 }}>
              <label htmlFor={planField} style={{ fontSize: 13, fontWeight: 600 }}>
                {t("planLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <select
                id={planField}
                value={planId}
                onChange={(e) => selectPlan(e.target.value)}
                aria-required="true"
                aria-invalid={(showErrors && !plan) || undefined}
                aria-describedby={showErrors && !plan ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              >
                <option value="">{t("planPlaceholder")}</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {t("planOption", { name: p.name, fy: p.fy, budget: formatMoney(p.totalBudgetMinor) })}
                  </option>
                ))}
              </select>
            </div>
          )}

          {plan && check && (
            <fieldset style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12 }} aria-describedby={budgetId}>
              <legend style={{ fontSize: 13, fontWeight: 600, padding: "0 4px" }}>{t("electionsLegend")}</legend>
              <div style={{ display: "grid", gap: 10 }}>
                {plan.components.map((c, idx) => {
                  const amtId = `${planField}-c-${idx}`;
                  const problem = check.lines[c.name];
                  const invalid = !!problem && showErrors;
                  return (
                    <div key={c.name} style={{ display: "grid", gap: 4 }}>
                      <label htmlFor={amtId} style={{ fontSize: 13 }}>
                        {c.name}{" "}
                        <span style={{ color: "var(--ink2)", fontSize: 12 }}>
                          {t("componentMaxHint", { max: formatMoney(c.maxMinor) })}
                          {c.taxExempt ? ` · ${t("taxExemptHint")}` : ""}
                        </span>
                      </label>
                      <input
                        id={amtId}
                        inputMode="decimal"
                        value={amounts[c.name] ?? ""}
                        onChange={(e) => setAmounts((prev) => ({ ...prev, [c.name]: e.target.value }))}
                        aria-invalid={invalid || problem === "overMax" || undefined}
                        aria-describedby={problem ? `${amtId}-err` : undefined}
                        style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 40, maxWidth: 240 }}
                      />
                      {problem && (showErrors || problem === "overMax") && (
                        <span id={`${amtId}-err`} role="alert" style={{ fontSize: 12, color: "var(--bad, #c0392b)" }}>
                          {problem === "overMax" ? t("overMaxError", { max: formatMoney(c.maxMinor) }) : t("amountInvalidError")}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </fieldset>
          )}

          {plan && check && (
            <p id={budgetId} style={{ fontSize: 13, color: check.overBudget ? "var(--bad, #c0392b)" : "var(--ink2)" }}>
              {t.rich("totalAgainstBudgetText", {
                amount: formatMoney(check.totalMinor),
                budget: formatMoney(plan.totalBudgetMinor),
                remaining: formatMoney(check.overBudget ? 0n : BigInt(plan.totalBudgetMinor) - check.totalMinor),
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </p>
          )}

          {plans.length > 0 && (
            <div>
              <Button type="submit" style={{ minHeight: 44 }} disabled={busy || (!!plan && blocked)} loading={busy}>
                {t("submitElectionBtn")}
              </Button>
            </div>
          )}

          {message && (
            <p
              id={errId}
              role={tone === "bad" ? "alert" : "status"}
              aria-live={tone === "bad" ? undefined : "polite"}
              className={`pill ${tone}`}
              style={{ width: "fit-content" }}
            >
              {message}
            </p>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title={t("confirmTitle")}
        confirmLabel={t("confirmLabel")}
        busy={busy}
        errorMessage={dialogError}
        description={
          plan && check
            ? t.rich("confirmDescription", {
                amount: formatMoney(check.totalMinor),
                plan: plan.name,
                fy: plan.fy,
                strong: (chunks) => <strong>{chunks}</strong>,
              })
            : null
        }
        onConfirm={() => void submitElection()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
