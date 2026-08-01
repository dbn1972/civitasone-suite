"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ConfirmDialog } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";

const SEPARATION_TYPES = ["retirement", "superannuation", "resignation", "retrenchment", "vrs", "death"] as const;
const EMPLOYEE_CATEGORIES = ["govt", "non_govt_covered", "non_govt_uncovered"] as const;

type MoneyField =
  | "noticeBuyout" | "leaveEncashmentGross" | "gratuityGross" | "retrenchmentComp" | "vrsComp"
  | "arrears" | "lastDrawnWages" | "avgSalaryLast10Months" | "priorLeaveEncashExemption"
  | "salaryYtd" | "tdsYtd" | "deductions80c" | "deductions80d" | "otherDeductions";

const REQUIRED_MONEY_FIELDS: MoneyField[] = ["lastDrawnWages", "avgSalaryLast10Months", "salaryYtd", "tdsYtd"];

const MONEY_LABELS: Record<MoneyField, string> = {
  noticeBuyout: "Notice Buyout (₹)",
  leaveEncashmentGross: "Leave Encashment Gross (₹)",
  gratuityGross: "Gratuity Gross (₹)",
  retrenchmentComp: "Retrenchment Compensation (₹)",
  vrsComp: "VRS Compensation (₹)",
  arrears: "Arrears (₹)",
  lastDrawnWages: "Last Drawn Wages (₹)",
  avgSalaryLast10Months: "Avg Salary — Last 10 Months (₹)",
  priorLeaveEncashExemption: "Prior Leave Encashment Exemption Used (₹)",
  salaryYtd: "Salary YTD (₹)",
  tdsYtd: "TDS YTD (₹)",
  deductions80c: "Deductions — Section 80C (₹)",
  deductions80d: "Deductions — Section 80D (₹)",
  otherDeductions: "Other Deductions (₹)",
};

const MONEY_FIELDS = Object.keys(MONEY_LABELS) as MoneyField[];

// Non-money required fields, in tab/focus order, so the "first invalid field"
// lookup below can walk one flat list instead of a chain of if/else.
const REQUIRED_TOP_FIELDS = ["employeeId", "separationDate", "completedYears", "leaveBalanceDays", "fyStartYear"] as const;
type TopField = (typeof REQUIRED_TOP_FIELDS)[number];
type FieldKey = TopField | MoneyField;

function toMinorString(rupees: string): string {
  const n = Number(rupees || "0");
  return Math.round((Number.isFinite(n) ? n : 0) * 100).toString();
}

export function ComputeFnfForm() {
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState("");
  const [separationDate, setSeparationDate] = useState("");
  const [separationType, setSeparationType] = useState<(typeof SEPARATION_TYPES)[number]>("resignation");
  const [employeeCategory, setEmployeeCategory] = useState<(typeof EMPLOYEE_CATEGORIES)[number]>("non_govt_covered");
  const [taxRegime, setTaxRegime] = useState<"old" | "new">("new");
  const [completedYears, setCompletedYears] = useState("");
  const [leaveBalanceDays, setLeaveBalanceDays] = useState("");
  const [remainingMonthsToRetirement, setRemainingMonthsToRetirement] = useState("0");
  const [fyStartYear, setFyStartYear] = useState(String(new Date().getFullYear()));
  const [money, setMoney] = useState<Record<MoneyField, string>>(
    Object.fromEntries(MONEY_FIELDS.map((f) => [f, ""])) as Record<MoneyField, string>,
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [invalidFields, setInvalidFields] = useState<Set<FieldKey>>(new Set());

  const baseId = useId();
  const empIdField = useId();
  const dateField = useId();
  const sepTypeField = useId();
  const catField = useId();
  const regimeField = useId();
  const yearsField = useId();
  const leaveField = useId();
  const remainingField = useId();
  const fyField = useId();
  const errId = useId();

  const topFieldRefs = useRef<Partial<Record<TopField, HTMLInputElement | null>>>({});
  const moneyFieldRefs = useRef<Partial<Record<MoneyField, HTMLInputElement | null>>>({});

  function setMoneyField(field: MoneyField, value: string) {
    setMoney((prev) => ({ ...prev, [field]: value }));
    if (invalidFields.has(field)) {
      setInvalidFields((prev) => {
        const next = new Set(prev);
        next.delete(field);
        return next;
      });
    }
  }

  function clearTopInvalid(field: TopField) {
    if (invalidFields.has(field)) {
      setInvalidFields((prev) => {
        const next = new Set(prev);
        next.delete(field);
        return next;
      });
    }
  }

  function openConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setMessage(null);

    const missing = new Set<FieldKey>();
    if (!employeeId.trim()) missing.add("employeeId");
    if (!separationDate) missing.add("separationDate");
    if (!completedYears) missing.add("completedYears");
    if (!leaveBalanceDays) missing.add("leaveBalanceDays");
    if (!fyStartYear) missing.add("fyStartYear");
    for (const f of REQUIRED_MONEY_FIELDS) {
      if (!money[f].trim()) missing.add(f);
    }

    setInvalidFields(missing);

    if (missing.size > 0) {
      setError("Employee, separation date, completed years, leave balance, FY start year and the required money fields are all required.");
      const orderedKeys: FieldKey[] = [...REQUIRED_TOP_FIELDS, ...REQUIRED_MONEY_FIELDS];
      const firstInvalid = orderedKeys.find((k) => missing.has(k));
      if (firstInvalid) {
        if ((REQUIRED_TOP_FIELDS as readonly string[]).includes(firstInvalid)) {
          topFieldRefs.current[firstInvalid as TopField]?.focus();
        } else {
          moneyFieldRefs.current[firstInvalid as MoneyField]?.focus();
        }
      }
      return;
    }
    setConfirmOpen(true);
  }

  async function compute() {
    setBusy(true);
    setError(undefined);
    try {
      const res = await browserJson<{ data: { message: string; employeeId: string } }>("v1/payroll/fnf/compute", {
        method: "POST",
        body: JSON.stringify({
          employeeId: employeeId.trim(),
          separationDate,
          separationType,
          employeeCategory,
          noticeBuyoutMinor: toMinorString(money.noticeBuyout),
          leaveEncashmentGrossMinor: toMinorString(money.leaveEncashmentGross),
          gratuityGrossMinor: toMinorString(money.gratuityGross),
          retrenchmentCompMinor: toMinorString(money.retrenchmentComp),
          vrsCompMinor: toMinorString(money.vrsComp),
          arrearsMinor: toMinorString(money.arrears),
          lastDrawnWagesMinor: toMinorString(money.lastDrawnWages),
          completedYears: Number(completedYears),
          avgSalaryLast10MonthsMinor: toMinorString(money.avgSalaryLast10Months),
          leaveBalanceDays: Number(leaveBalanceDays),
          priorLeaveEncashExemptionMinor: toMinorString(money.priorLeaveEncashExemption),
          remainingMonthsToRetirement: Number(remainingMonthsToRetirement || "0"),
          taxRegime,
          salaryYtdMinor: toMinorString(money.salaryYtd),
          tdsYtdMinor: toMinorString(money.tdsYtd),
          deductions80cMinor: toMinorString(money.deductions80c),
          deductions80dMinor: toMinorString(money.deductions80d),
          otherDeductionsMinor: toMinorString(money.otherDeductions),
          fyStartYear: Number(fyStartYear),
        }),
      });
      setConfirmOpen(false);
      setMessage(res.data.message ?? "F&F compute queued.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={openConfirm} style={{ marginBottom: 16 }}>
      <Card title="Compute F&F Settlement" padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={empIdField} style={{ fontSize: 13, fontWeight: 600 }}>
                Employee ID (UUID) <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={empIdField}
                ref={(el) => { topFieldRefs.current.employeeId = el; }}
                value={employeeId}
                onChange={(e) => { setEmployeeId(e.target.value); clearTopInvalid("employeeId"); }}
                aria-required="true"
                aria-invalid={invalidFields.has("employeeId") || undefined}
                aria-describedby={invalidFields.has("employeeId") ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={dateField} style={{ fontSize: 13, fontWeight: 600 }}>
                Separation Date <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={dateField}
                ref={(el) => { topFieldRefs.current.separationDate = el; }}
                type="date"
                value={separationDate}
                onChange={(e) => { setSeparationDate(e.target.value); clearTopInvalid("separationDate"); }}
                aria-required="true"
                aria-invalid={invalidFields.has("separationDate") || undefined}
                aria-describedby={invalidFields.has("separationDate") ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={sepTypeField} style={{ fontSize: 13, fontWeight: 600 }}>Separation Type</label>
              <select id={sepTypeField} value={separationType} onChange={(e) => setSeparationType(e.target.value as (typeof SEPARATION_TYPES)[number])} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}>
                {SEPARATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={catField} style={{ fontSize: 13, fontWeight: 600 }}>Employee Category</label>
              <select id={catField} value={employeeCategory} onChange={(e) => setEmployeeCategory(e.target.value as (typeof EMPLOYEE_CATEGORIES)[number])} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}>
                {EMPLOYEE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={regimeField} style={{ fontSize: 13, fontWeight: 600 }}>Tax Regime</label>
              <select id={regimeField} value={taxRegime} onChange={(e) => setTaxRegime(e.target.value as "old" | "new")} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}>
                <option value="old">Old</option>
                <option value="new">New</option>
              </select>
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={yearsField} style={{ fontSize: 13, fontWeight: 600 }}>
                Completed Years <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={yearsField}
                ref={(el) => { topFieldRefs.current.completedYears = el; }}
                type="number"
                min={0}
                value={completedYears}
                onChange={(e) => { setCompletedYears(e.target.value); clearTopInvalid("completedYears"); }}
                aria-required="true"
                aria-invalid={invalidFields.has("completedYears") || undefined}
                aria-describedby={invalidFields.has("completedYears") ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={leaveField} style={{ fontSize: 13, fontWeight: 600 }}>
                Leave Balance (days) <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={leaveField}
                ref={(el) => { topFieldRefs.current.leaveBalanceDays = el; }}
                type="number"
                min={0}
                value={leaveBalanceDays}
                onChange={(e) => { setLeaveBalanceDays(e.target.value); clearTopInvalid("leaveBalanceDays"); }}
                aria-required="true"
                aria-invalid={invalidFields.has("leaveBalanceDays") || undefined}
                aria-describedby={invalidFields.has("leaveBalanceDays") ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={remainingField} style={{ fontSize: 13, fontWeight: 600 }}>Remaining Months to Retirement</label>
              <input id={remainingField} type="number" min={0} value={remainingMonthsToRetirement} onChange={(e) => setRemainingMonthsToRetirement(e.target.value)} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }} />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={fyField} style={{ fontSize: 13, fontWeight: 600 }}>
                FY Start Year <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={fyField}
                ref={(el) => { topFieldRefs.current.fyStartYear = el; }}
                type="number"
                value={fyStartYear}
                onChange={(e) => { setFyStartYear(e.target.value); clearTopInvalid("fyStartYear"); }}
                aria-required="true"
                aria-invalid={invalidFields.has("fyStartYear") || undefined}
                aria-describedby={invalidFields.has("fyStartYear") ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
          </div>

          <fieldset style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 14 }}>
            <legend style={{ fontSize: 13, fontWeight: 700, padding: "0 6px" }}>Amounts (₹)</legend>
            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
              {MONEY_FIELDS.map((f) => {
                const id = `${baseId}-${f}`;
                const required = REQUIRED_MONEY_FIELDS.includes(f);
                const invalid = invalidFields.has(f);
                return (
                  <div key={f} style={{ display: "grid", gap: 6 }}>
                    <label htmlFor={id} style={{ fontSize: 13, fontWeight: 600 }}>
                      {MONEY_LABELS[f]} {required && <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>}
                    </label>
                    <input
                      id={id}
                      ref={(el) => { moneyFieldRefs.current[f] = el; }}
                      type="number"
                      min={0}
                      step="0.01"
                      value={money[f]}
                      onChange={(e) => setMoneyField(f, e.target.value)}
                      aria-required={required}
                      aria-invalid={invalid || undefined}
                      aria-describedby={invalid ? errId : undefined}
                      style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
                    />
                  </div>
                );
              })}
            </div>
          </fieldset>

          <div>
            <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
              Compute Settlement
            </button>
          </div>

          {error && !confirmOpen && (
            <p id={errId} role="alert" className="pill bad" style={{ width: "fit-content" }}>{error}</p>
          )}
          {message && (
            <p role="status" className="pill good" style={{ width: "fit-content" }}>{message}</p>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title="Compute this F&F settlement?"
        danger
        confirmLabel="Compute settlement"
        busy={busy}
        errorMessage={error}
        description={
          <>
            This queues an F&amp;F settlement computation for employee <strong>{employeeId}</strong>{" "}
            ({separationType}, {separationDate}). Statutory exemption and tax figures are computed
            server-side from raw statutory rules — no values are rounded before display.
          </>
        }
        onConfirm={() => void compute()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
