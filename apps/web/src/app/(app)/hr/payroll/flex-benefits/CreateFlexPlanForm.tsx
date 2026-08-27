"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ConfirmDialog } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";
import { currentFinancialYear } from "@/lib/fiscalYear";

type PlanComponent = { name: string; maxAmount: string; taxExempt: boolean };
type PlanResponse = { data: { id: string; name: string; fy: string; totalBudgetMinor: number; status: string } };

const emptyComponent = (): PlanComponent => ({ name: "", maxAmount: "", taxExempt: false });

export function CreateFlexPlanForm() {
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

  const nameInvalid = tone === "bad" && message === "Plan name is required.";
  const fyInvalid = tone === "bad" && !!message && message.startsWith("Financial year");
  const budgetInvalid = tone === "bad" && !!message && message.startsWith("Total budget");
  const compGroupInvalid = tone === "bad" && !!message && message.startsWith("Each component");

  function isComponentInvalid(c: PlanComponent): boolean {
    if (!compGroupInvalid) return false;
    return !c.name.trim() || !(parseFloat(c.maxAmount) > 0);
  }

  function updateComponent(idx: number, patch: Partial<PlanComponent>) {
    setComponents((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!name.trim()) {
      setTone("bad");
      setMessage("Plan name is required.");
      nameRef.current?.focus();
      return;
    }
    if (!/^\d{4}-\d{2}$/.test(fy.trim())) {
      setTone("bad");
      setMessage("Financial year must be in YYYY-YY format, e.g. 2025-26.");
      fyRef.current?.focus();
      return;
    }
    const budget = parseFloat(totalBudget);
    if (Number.isNaN(budget) || budget <= 0) {
      setTone("bad");
      setMessage("Total budget must be a positive amount in rupees.");
      budgetRef.current?.focus();
      return;
    }
    const validComponents = components.filter((c) => c.name.trim());
    const firstInvalidIdx = components.findIndex((c) => !c.name.trim() || !(parseFloat(c.maxAmount) > 0));
    if (validComponents.length === 0 || validComponents.some((c) => !(parseFloat(c.maxAmount) > 0))) {
      setTone("bad");
      setMessage("Each component needs a name and a positive maximum amount.");
      if (firstInvalidIdx >= 0) componentNameRefs.current[firstInvalidIdx]?.focus();
      return;
    }
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function createPlan() {
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await browserJson<PlanResponse>("v1/payroll/flex-benefits/plans", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          fy: fy.trim(),
          totalBudgetMinor: Math.round(parseFloat(totalBudget) * 100),
          components: components
            .filter((c) => c.name.trim())
            .map((c) => ({ name: c.name.trim(), maxMinor: Math.round(parseFloat(c.maxAmount) * 100), taxExempt: c.taxExempt })),
        }),
      });
      setConfirmOpen(false);
      setTone("good");
      setMessage(`Flex benefit plan "${res.data.name}" created.`);
      setName("");
      setTotalBudget("");
      setComponents([emptyComponent()]);
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <Card title="Create Flex Benefit Plan" padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={nameId} style={{ fontSize: 13, fontWeight: 600 }}>
                Plan Name <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
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
                Financial Year <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
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
                Total Budget (₹) <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
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
              Plan Components <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </legend>
            <div style={{ display: "grid", gap: 10 }}>
              {components.map((c, idx) => {
                const compNameId = `${nameId}-comp-${idx}-name`;
                const compMaxId = `${nameId}-comp-${idx}-max`;
                const compExemptId = `${nameId}-comp-${idx}-exempt`;
                const rowInvalid = isComponentInvalid(c);
                return (
                  <div key={idx} style={{ display: "grid", gap: 10, gridTemplateColumns: "2fr 1fr auto auto", alignItems: "end" }}>
                    <div style={{ display: "grid", gap: 4 }}>
                      <label htmlFor={compNameId} style={{ fontSize: 12 }}>Component Name</label>
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
                      <label htmlFor={compMaxId} style={{ fontSize: 12 }}>Max Amount (₹)</label>
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
                      <label htmlFor={compExemptId} style={{ fontSize: 12 }}>Tax exempt</label>
                    </div>
                    <button
                      type="button"
                      className="btn ghost"
                      style={{ minHeight: 40 }}
                      aria-label={`Remove component ${idx + 1}${c.name ? `: ${c.name}` : ""}`}
                      onClick={() => setComponents((prev) => prev.filter((_, i) => i !== idx))}
                      disabled={components.length === 1}
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
              <div>
                <button
                  type="button"
                  className="btn ghost"
                  style={{ minHeight: 40 }}
                  onClick={() => setComponents((prev) => [...prev, emptyComponent()])}
                >
                  + Add component
                </button>
              </div>
            </div>
          </fieldset>

          <div>
            <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
              Create Plan
            </button>
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
        title="Create this flex benefit plan?"
        confirmLabel="Create plan"
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            Create plan <strong>{name}</strong> for FY {fy} with a total budget of{" "}
            {formatMoney(Math.round((parseFloat(totalBudget) || 0) * 100))}.
          </>
        }
        onConfirm={() => void createPlan()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
