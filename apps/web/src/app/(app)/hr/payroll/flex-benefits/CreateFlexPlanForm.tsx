"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card, ConfirmDialog, Button } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";
import { currentFinancialYear, isValidFinancialYearLabel } from "@/lib/fiscalYear";
import { rupeesToMinorString } from "@/lib/money";

type PlanComponent = { name: string; maxAmount: string; taxExempt: boolean };

/** Paise as a safe JS number, or null (invalid / non-positive / too large). */
function toPaise(input: string): number | null {
  const minor = rupeesToMinorString(input);
  if (minor === null || BigInt(minor) > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(minor);
}

const emptyComponent = (): PlanComponent => ({ name: "", maxAmount: "", taxExempt: false });

export function CreateFlexPlanForm() {
  const t = useTranslations("createFlexPlanForm");
  const router = useRouter();
  const [name, setName] = useState("");
  // Default to the current FY so the common case needs no typing — the field
  // stays editable for anyone planning next year's plan ahead of time.
  const [fy, setFy] = useState(currentFinancialYear);
  const [totalBudget, setTotalBudget] = useState("");
  const [components, setComponents] = useState<PlanComponent[]>([emptyComponent()]);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");

  const nameId = useId();
  const fyId = useId();
  const budgetId = useId();
  const errId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const fyRef = useRef<HTMLInputElement>(null);
  const budgetRef = useRef<HTMLInputElement>(null);
  const componentNameRefs = useRef<Array<HTMLInputElement | null>>([]);

  // Stable per-row React key, independent of array position -- see
  // ElectFlexBenefitForm.tsx (same directory) for the full rationale:
  // keying by index let removing an earlier component shift a later,
  // focused one up into a different key, so React patched the focused DOM
  // node in place with the wrong component's data instead of removing the
  // right node and leaving the rest (and focus) alone.
  const nextComponentRowId = useRef(0);
  const [componentRowIds, setComponentRowIds] = useState<number[]>(() => [nextComponentRowId.current++]);
  const componentKeyFor = (idx: number) => componentRowIds[idx] ?? idx;

  function addComponent() {
    setComponents((prev) => [...prev, emptyComponent()]);
    setComponentRowIds((ids) => [...ids, nextComponentRowId.current++]);
  }
  function removeComponent(idx: number) {
    setComponents((prev) => prev.filter((_, i) => i !== idx));
    setComponentRowIds((ids) => ids.filter((_, i) => i !== idx));
  }
  function resetComponents() {
    setComponents([emptyComponent()]);
    setComponentRowIds([nextComponentRowId.current++]);
  }

  const [invalidField, setInvalidField] = useState<"name" | "fy" | "budget" | "components" | null>(null);
  const nameInvalid = tone === "bad" && invalidField === "name";
  const fyInvalid = tone === "bad" && invalidField === "fy";
  const budgetInvalid = tone === "bad" && invalidField === "budget";
  const compGroupInvalid = tone === "bad" && invalidField === "components";

  function isComponentInvalid(c: PlanComponent): boolean {
    if (!compGroupInvalid) return false;
    return !c.name.trim() || toPaise(c.maxAmount) === null;
  }

  function updateComponent(idx: number, patch: Partial<PlanComponent>) {
    setComponents((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setInvalidField(null);
    if (!name.trim()) {
      setTone("bad");
      setInvalidField("name");
      setMessage(t("nameRequiredError"));
      nameRef.current?.focus();
      return;
    }
    // GAP-PAYROLL-FLEX-BENEFITS-03: "2026-99" / "2026-05" used to pass.
    if (!isValidFinancialYearLabel(fy)) {
      setTone("bad");
      setInvalidField("fy");
      setMessage(t("fyFormatError"));
      fyRef.current?.focus();
      return;
    }
    // GAP-PAYROLL-FLEX-BENEFITS-03: string -> paise, no parseFloat * 100.
    const budgetMinor = toPaise(totalBudget);
    if (budgetMinor === null) {
      setTone("bad");
      setInvalidField("budget");
      setMessage(t("budgetRequiredError"));
      budgetRef.current?.focus();
      return;
    }
    const validComponents = components.filter((c) => c.name.trim());
    const firstInvalidIdx = components.findIndex((c) => !c.name.trim() || toPaise(c.maxAmount) === null);
    if (validComponents.length === 0 || validComponents.some((c) => toPaise(c.maxAmount) === null)) {
      setTone("bad");
      setInvalidField("components");
      setMessage(t("componentsRequiredError"));
      if (firstInvalidIdx >= 0) componentNameRefs.current[firstInvalidIdx]?.focus();
      return;
    }
    // GAP-PAYROLL-FLEX-BENEFITS-03: an election is matched to a component by
    // name, so names must be unique; and the component caps must fit inside
    // the plan budget.
    const names = validComponents.map((c) => c.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) {
      setTone("bad");
      setInvalidField("components");
      setMessage(t("duplicateComponentError"));
      return;
    }
    const capsMinor = validComponents.reduce((sum, c) => sum + BigInt(toPaise(c.maxAmount)!), 0n);
    if (capsMinor > BigInt(budgetMinor)) {
      setTone("bad");
      setInvalidField("components");
      setMessage(t("componentsOverBudgetError", { caps: formatMoney(capsMinor), budget: formatMoney(budgetMinor) }));
      return;
    }
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function createPlan() {
    setBusy(true);
    setDialogError(undefined);
    try {
      // CQRS: the route answers 202 { id, status: "accepted" } -- there is no
      // `data` envelope, so the old `res.data.name` threw on every success.
      const planName = name.trim();
      await browserJson<{ id: string; status: string }>("v1/payroll/flex-benefits/plans", {
        method: "POST",
        body: JSON.stringify({
          name: planName,
          fy: fy.trim(),
          totalBudgetMinor: toPaise(totalBudget),
          components: components
            .filter((c) => c.name.trim())
            .map((c) => ({ name: c.name.trim(), maxMinor: toPaise(c.maxAmount), taxExempt: c.taxExempt })),
        }),
      });
      setConfirmOpen(false);
      setTone("good");
      setInvalidField(null);
      setMessage(t("createdMessage", { name: planName }));
      setName("");
      setTotalBudget("");
      resetComponents();
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <Card title={t("formTitle")} padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={nameId} style={{ fontSize: 13, fontWeight: 600 }}>
                {t("planNameLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={nameId}
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={128}
                aria-required="true"
                aria-invalid={nameInvalid || undefined}
                aria-describedby={nameInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={fyId} style={{ fontSize: 13, fontWeight: 600 }}>
                {t("financialYearLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={fyId}
                ref={fyRef}
                value={fy}
                onChange={(e) => setFy(e.target.value)}
                placeholder="2025-26"
                aria-required="true"
                aria-invalid={fyInvalid || undefined}
                aria-describedby={fyInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={budgetId} style={{ fontSize: 13, fontWeight: 600 }}>
                {t("totalBudgetLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={budgetId}
                ref={budgetRef}
                type="number"
                min="0"
                step="0.01"
                value={totalBudget}
                onChange={(e) => setTotalBudget(e.target.value)}
                aria-required="true"
                aria-invalid={budgetInvalid || undefined}
                aria-describedby={budgetInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
          </div>

          <fieldset style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12 }}>
            <legend style={{ fontSize: 13, fontWeight: 600, padding: "0 4px" }}>
              {t("planComponentsLegend")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </legend>
            <div style={{ display: "grid", gap: 10 }}>
              {components.map((c, idx) => {
                const compNameId = `${nameId}-comp-${idx}-name`;
                const compMaxId = `${nameId}-comp-${idx}-max`;
                const compExemptId = `${nameId}-comp-${idx}-exempt`;
                const rowInvalid = isComponentInvalid(c);
                return (
                  <div key={componentKeyFor(idx)} style={{ display: "grid", gap: 10, gridTemplateColumns: "2fr 1fr auto auto", alignItems: "end" }}>
                    <div style={{ display: "grid", gap: 4 }}>
                      <label htmlFor={compNameId} style={{ fontSize: 12 }}>{t("componentNameLabel")}</label>
                      <input
                        id={compNameId}
                        ref={(el) => { componentNameRefs.current[idx] = el; }}
                        value={c.name}
                        aria-invalid={rowInvalid || undefined}
                        aria-describedby={rowInvalid ? errId : undefined}
                        onChange={(e) => updateComponent(idx, { name: e.target.value })}
                        style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 40 }}
                      />
                    </div>
                    <div style={{ display: "grid", gap: 4 }}>
                      <label htmlFor={compMaxId} style={{ fontSize: 12 }}>{t("maxAmountLabel")}</label>
                      <input
                        id={compMaxId}
                        type="number"
                        min="0"
                        step="0.01"
                        value={c.maxAmount}
                        aria-invalid={rowInvalid || undefined}
                        aria-describedby={rowInvalid ? errId : undefined}
                        onChange={(e) => updateComponent(idx, { maxAmount: e.target.value })}
                        style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 40 }}
                      />
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <input
                        id={compExemptId}
                        type="checkbox"
                        checked={c.taxExempt}
                        onChange={(e) => updateComponent(idx, { taxExempt: e.target.checked })}
                      />
                      <label htmlFor={compExemptId} style={{ fontSize: 12 }}>{t("taxExemptLabel")}</label>
                    </div>
                    <Button
                      variant="ghost"
                      style={{ minHeight: 40 }}
                      aria-label={c.name ? t("removeComponentNamedAriaLabel", { index: idx + 1, name: c.name }) : t("removeComponentAriaLabel", { index: idx + 1 })}
                      onClick={() => removeComponent(idx)}
                      disabled={components.length === 1}
                    >
                      {t("removeBtn")}
                    </Button>
                  </div>
                );
              })}
              <div>
                <Button
                  variant="ghost"
                  style={{ minHeight: 40 }}
                  onClick={addComponent}
                >
                  {t("addComponentBtn")}
                </Button>
              </div>
            </div>
          </fieldset>

          <div>
            <Button type="submit" style={{ minHeight: 44 }} disabled={busy} loading={busy}>
              {t("createPlanBtn")}
            </Button>
          </div>

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
        description={t.rich("confirmDescription", {
          name,
          fy,
          amount: formatMoney(toPaise(totalBudget)),
          strong: (chunks) => <strong>{chunks}</strong>,
        })}
        onConfirm={() => void createPlan()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
