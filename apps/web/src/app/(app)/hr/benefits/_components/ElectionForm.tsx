"use client";

/**
 * GAP-HR-BENEFITS-02: POST /v1/hrms/benefits/elections already existed
 * (gap-features/routes.ts) but no page ever called it -- there was no plan
 * list to drive a form and no UI action at all, despite empty-state copy
 * promising elections are "submitted during the benefit window". This adds
 * the missing client form; the plan list itself comes from the new GET
 * /v1/hrms/benefits/plans route added alongside this component.
 *
 * HUMAN REVIEW (money): amounts are entered in rupees and converted to paise
 * client-side via the shared rupeesToMinorString helper (never
 * Number(x) * 100), then re-validated server-side by gap-features/routes.ts's
 * own zod body. The election upserts on (tenant, plan, employee, fy) --
 * resubmitting the same plan/FY intentionally replaces the prior election,
 * matching the backend's existing ON CONFLICT behavior.
 */
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "../../../../_components/ds";
import { useFormError } from "@/lib/useFormError";
import { rupeesToMinorString } from "@/lib/money";

export type BenefitPlan = {
  id: string;
  name: string;
  fy: string;
  components: Array<{ name: string; maxMinor: number; taxExempt: boolean }>;
};

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 12px", border: "1px solid var(--line)",
  borderRadius: 8, background: "var(--bg2)", color: "var(--ink)", fontSize: 14,
};
const inputErrStyle: React.CSSProperties = { ...inputStyle, border: "1px solid var(--badbd, #ef4444)" };
const fieldErrStyle: React.CSSProperties = { color: "var(--bad, #b91c1c)", fontSize: 12, margin: "3px 0 0" };

interface Props {
  plans: BenefitPlan[];
}

export function ElectionForm({ plans }: Props) {
  const t = useTranslations("benefits");
  const ids = { plan: useId() };
  const [open, setOpen] = useState(false);
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const formError = useFormError("benefit election");

  const selectedPlan = plans.find((p) => p.id === planId);

  if (plans.length === 0) return null;

  function setAmount(component: string, value: string) {
    setAmounts((a) => ({ ...a, [component]: value }));
    setInvalid((s) => { const n = new Set(s); n.delete(component); return n; });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedPlan) return;
    const errs = new Set<string>();
    const elections: Array<{ component: string; electedMinor: number }> = [];
    for (const c of selectedPlan.components) {
      const raw = amounts[c.name];
      if (!raw || !raw.trim()) continue; // an unset component is simply not elected
      const minor = rupeesToMinorString(raw);
      if (minor === null) {
        errs.add(c.name);
        continue;
      }
      elections.push({ component: c.name, electedMinor: Number(minor) });
    }
    if (elections.length === 0) errs.add("__form__");
    setInvalid(errs);
    if (errs.size > 0) return;

    setBusy(true);
    setMessage(null);
    formError.clear();
    try {
      const res = await fetch("/api/proxy/v1/hrms/benefits/elections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planId: selectedPlan.id, fy: selectedPlan.fy, elections }),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setMessage({ tone: "bad", text: resolved.message });
        return;
      }
      setMessage({ tone: "good", text: t("electionSubmitted") });
      setAmounts({});
      setOpen(false);
      router.refresh();
    } catch {
      setMessage({ tone: "bad", text: formError.fromException("save").message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Button type="button" size="sm" onClick={() => { setOpen((o) => !o); setMessage(null); }} aria-expanded={open}>
        {open ? t("cancelElection") : t("makeElection")}
      </Button>

      {open && (
        <div className="card" style={{ marginTop: 12, marginBottom: 0 }}>
          <form onSubmit={handleSubmit} noValidate style={{ padding: "16px 20px 20px", display: "grid", gap: 14 }}>
            {message && (
              <p role="alert" className={`pill ${message.tone}`} style={{ margin: 0 }}>
                {message.text}
              </p>
            )}

            <div>
              <label htmlFor={ids.plan} style={{ fontSize: 13, fontWeight: 500 }}>{t("planLabel")}</label>
              <select
                id={ids.plan}
                value={planId}
                onChange={(e) => { setPlanId(e.target.value); setAmounts({}); setInvalid(new Set()); }}
                style={inputStyle}
              >
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.fy})</option>
                ))}
              </select>
            </div>

            {selectedPlan?.components.map((c) => (
              <div key={c.name}>
                <label htmlFor={`${ids.plan}-${c.name}`} style={{ fontSize: 13, fontWeight: 500 }}>
                  {c.name}
                  {c.taxExempt ? ` (${t("taxExempt")})` : ""}
                </label>
                <input
                  id={`${ids.plan}-${c.name}`}
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amounts[c.name] ?? ""}
                  onChange={(e) => setAmount(c.name, e.target.value)}
                  style={invalid.has(c.name) ? inputErrStyle : inputStyle}
                  aria-invalid={invalid.has(c.name)}
                  aria-describedby={invalid.has(c.name) ? `${ids.plan}-${c.name}-err` : undefined}
                />
                {invalid.has(c.name) && (
                  <p id={`${ids.plan}-${c.name}-err`} role="alert" style={fieldErrStyle}>
                    {t("invalidAmount")}
                  </p>
                )}
              </div>
            ))}
            {invalid.has("__form__") && (
              <p role="alert" style={fieldErrStyle}>{t("noAmountsEntered")}</p>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Button type="submit" disabled={busy} style={{ minHeight: 44, minWidth: 140 }}>
                {busy ? t("submitting") : t("submitElection")}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
