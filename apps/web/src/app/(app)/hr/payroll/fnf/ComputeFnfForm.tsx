"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card, ConfirmDialog, EntityPicker, type EntityOption } from "../../../../_components/ds";
import { browserFetch, browserJson, errorCodeFromResponse } from "@/lib/api/browserClient";
import { useFormError } from "@/lib/useFormError";
import { minorToDecimalString, nonNegativeRupeesToMinorString } from "@/lib/money";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { searchPayrollEmployees } from "@/lib/entityAdapters/payrollEmployee";
import { FNF_POLL_INTERVAL_MS, FNF_POLL_MAX_TICKS } from "./fnfWorkflow";

const SEPARATION_TYPES = ["retirement", "superannuation", "resignation", "retrenchment", "vrs", "death"] as const;
const EMPLOYEE_CATEGORIES = ["govt", "non_govt_covered", "non_govt_uncovered"] as const;

type MoneyField =
  | "noticeBuyout" | "leaveEncashmentGross" | "gratuityGross" | "retrenchmentComp" | "vrsComp"
  | "arrears" | "lastDrawnWages" | "avgSalaryLast10Months" | "priorLeaveEncashExemption"
  | "salaryYtd" | "tdsYtd" | "deductions80c" | "deductions80d" | "otherDeductions";

const REQUIRED_MONEY_FIELDS: MoneyField[] = ["lastDrawnWages", "avgSalaryLast10Months", "salaryYtd", "tdsYtd"];

// UX-017: keys are stable field identities, never translated -- only used to
// look up which message key holds the display label.
const MONEY_FIELD_KEYS: Record<MoneyField, string> = {
  noticeBuyout: "noticeBuyoutLabel",
  leaveEncashmentGross: "leaveEncashmentGrossLabel",
  gratuityGross: "gratuityGrossLabel",
  retrenchmentComp: "retrenchmentCompLabel",
  vrsComp: "vrsCompLabel",
  arrears: "arrearsLabel",
  lastDrawnWages: "lastDrawnWagesLabel",
  avgSalaryLast10Months: "avgSalaryLast10MonthsLabel",
  priorLeaveEncashExemption: "priorLeaveEncashExemptionLabel",
  salaryYtd: "salaryYtdLabel",
  tdsYtd: "tdsYtdLabel",
  deductions80c: "deductions80cLabel",
  deductions80d: "deductions80dLabel",
  otherDeductions: "otherDeductionsLabel",
};

const MONEY_FIELDS = Object.keys(MONEY_FIELD_KEYS) as MoneyField[];

const REQUIRED_TOP_FIELDS = ["employeeId", "separationDate", "completedYears", "leaveBalanceDays", "fyStartYear"] as const;
type TopField = (typeof REQUIRED_TOP_FIELDS)[number];
type FieldKey = TopField | MoneyField | "overrideReason" | `nominee.${NomineeField}`;

/**
 * GAP-PAYROLL-FNF-03: pay-record-derived money inputs. payroll-service derives
 * them from the employee's finalised payslips (GET /v1/payroll/fnf/pay-snapshot)
 * and refuses a compute whose value differs without an override reason.
 */
export const PAY_FIELDS = ["lastDrawnWages", "avgSalaryLast10Months", "salaryYtd", "tdsYtd"] as const;
type PayField = (typeof PAY_FIELDS)[number];

/** Record-derived inputs: pre-filled from HR / pay records, editable only via an explicit override. */
type HrField = "completedYears" | "leaveBalanceDays";
type OverridableField = HrField | PayField;

/** GET /v1/payroll/fnf/pay-snapshot (payroll-service fnf/pay-snapshot.ts): paise as strings. */
type PaySnapshot = {
  available: boolean;
  fyStartYear: number;
  wageMonths: number;
  ytdMonths: number;
  lastDrawnWagesMinor: string;
  avgSalaryLast10MonthsMinor: string;
  salaryYtdMinor: string;
  tdsYtdMinor: string;
};

/** GAP-PAYROLL-FNF-05: payee of a death settlement. */
export const NOMINEE_RELATIONSHIPS = ["spouse", "son", "daughter", "father", "mother", "sibling", "other_legal_heir"] as const;
type NomineeField = "name" | "relationship" | "accountNumber" | "ifsc" | "documentRef";
const NOMINEE_ACCOUNT_RE = /^\d{9,18}$/;
const NOMINEE_IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/**
 * GAP-PAYROLL-FNF-03: what hrms-service derives from the employee's own
 * records for this separation date (POST /v1/hrms/employees/:id/
 * fnf-calculate -- a read-only calculation, nothing is persisted).
 */
type HrSnapshot = {
  completedYears: number;
  leaveBalanceDays: number;
  basicMonthlyMinor: number;
  gratuityEstimateMinor: number;
  leaveEncashmentEstimateMinor: number;
};

type FnfCalculateResponse = {
  basicMonthlyMinor?: number;
  breakdown?: {
    leaveEncashment?: { leaveBalanceDays?: number; amountMinor?: number };
    gratuity?: { completedYears?: number; amountMinor?: number };
  };
};

export const MIN_OVERRIDE_REASON = 10;

type SnapshotState = "idle" | "loading" | "loaded" | "unavailable";
type LabelMap = Map<string, string>;
const NO_OVERRIDES: Record<OverridableField, boolean> = {
  completedYears: false, leaveBalanceDays: false,
  lastDrawnWages: false, avgSalaryLast10Months: false, salaryYtd: false, tdsYtd: false,
};
const EMPTY_NOMINEE: Record<NomineeField, string> = { name: "", relationship: "", accountNumber: "", ifsc: "", documentRef: "" };

/** Rupee decimal string for a paise string (exact; no float). */
const rupeesOfMinor = (minor: string): string => minorToDecimalString(minor) ?? "";

export function ComputeFnfForm() {
  const t = useTranslations("computeFnfForm");
  const MONEY_LABELS: Record<MoneyField, string> = Object.fromEntries(
    (Object.keys(MONEY_FIELD_KEYS) as MoneyField[]).map((f) => [f, t(MONEY_FIELD_KEYS[f])]),
  ) as Record<MoneyField, string>;
  const SEPARATION_TYPE_LABELS: Record<(typeof SEPARATION_TYPES)[number], string> = {
    retirement: t("separationTypeRetirement"),
    superannuation: t("separationTypeSuperannuation"),
    resignation: t("separationTypeResignation"),
    retrenchment: t("separationTypeRetrenchment"),
    vrs: t("separationTypeVrs"),
    death: t("separationTypeDeath"),
  };
  const EMPLOYEE_CATEGORY_LABELS: Record<(typeof EMPLOYEE_CATEGORIES)[number], string> = {
    govt: t("employeeCategoryGovt"),
    non_govt_covered: t("employeeCategoryNonGovtCovered"),
    non_govt_uncovered: t("employeeCategoryNonGovtUncovered"),
  };
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState(null as string | null);
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
  const [snapshot, setSnapshot] = useState(null as HrSnapshot | null);
  const [snapshotState, setSnapshotState] = useState("idle" as SnapshotState);
  const [paySnap, setPaySnap] = useState(null as PaySnapshot | null);
  const [paySnapState, setPaySnapState] = useState("idle" as SnapshotState);
  const [nominee, setNominee] = useState(EMPTY_NOMINEE);
  const [override, setOverride] = useState(NO_OVERRIDES);
  const [overrideReason, setOverrideReason] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  // GAP-PAYROLL-FNF-04: compute is asynchronous (202 queued). After one is
  // queued, re-fetch the list every 5 s for up to a minute so the new
  // settlement appears without a manual reload; a Refresh button covers the rest.
  const [pollTicks, setPollTicks] = useState(0);
  const [polling, setPolling] = useState(false);
  useEffect(() => {
    if (!polling) return;
    if (pollTicks >= FNF_POLL_MAX_TICKS) {
      setPolling(false);
      return;
    }
    const timer = setTimeout(() => {
      router.refresh();
      setPollTicks((n) => n + 1);
    }, FNF_POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [polling, pollTicks, router]);
  const [invalidFields, setInvalidFields] = useState<Set<FieldKey>>(new Set());
  const formError = useFormError("F&F settlement");

  // GAP-PAYROLL-FNF-05: remember the label of every option the picker has
  // shown, so the confirm dialog names the employee instead of a UUID.
  const employeeLabels = useRef(new Map() as LabelMap);
  const [directoryForbidden, setDirectoryForbidden] = useState(false);
  async function searchAndRemember(query: string, signal: AbortSignal): Promise<EntityOption[]> {
    const options = await searchPayrollEmployees(query, signal, { onForbidden: () => setDirectoryForbidden(true) });
    for (const o of options) employeeLabels.current.set(o.id, o.label);
    return options;
  }
  const employeeLabel = employeeId ? employeeLabels.current.get(employeeId) ?? t("selectedEmployeeFallback") : "";

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
  const reasonField = useId();
  const errId = useId();

  const topFieldRefs = useRef<Partial<Record<TopField, HTMLInputElement | null>>>({});
  const moneyFieldRefs = useRef<Partial<Record<MoneyField, HTMLInputElement | null>>>({});
  const reasonRef = useRef<HTMLTextAreaElement | null>(null);

  // GAP-PAYROLL-FNF-03: once an employee and a separation date are chosen,
  // pull the record-derived inputs (completed years of service, leave
  // balance) from HR instead of trusting hand-typed numbers. Those fields
  // become read-only unless the clerk explicitly overrides them, which then
  // requires a reason that is persisted with the settlement and audited.
  useEffect(() => {
    if (!employeeId || !separationDate) {
      setSnapshot(null);
      setSnapshotState("idle");
      return;
    }
    let cancelled = false;
    setSnapshotState("loading");
    browserJson<FnfCalculateResponse>(`v1/hrms/employees/${encodeURIComponent(employeeId)}/fnf-calculate`, {
      method: "POST",
      body: JSON.stringify({ separationDate }),
    })
      .then((res) => {
        if (cancelled) return;
        const years = res.breakdown?.gratuity?.completedYears;
        const leave = res.breakdown?.leaveEncashment?.leaveBalanceDays;
        if (typeof years !== "number" || typeof leave !== "number") {
          setSnapshot(null);
          setSnapshotState("unavailable");
          return;
        }
        const snap: HrSnapshot = {
          completedYears: years,
          leaveBalanceDays: leave,
          basicMonthlyMinor: res.basicMonthlyMinor ?? 0,
          gratuityEstimateMinor: res.breakdown?.gratuity?.amountMinor ?? 0,
          leaveEncashmentEstimateMinor: res.breakdown?.leaveEncashment?.amountMinor ?? 0,
        };
        setSnapshot(snap);
        setSnapshotState("loaded");
        setCompletedYears(String(snap.completedYears));
        setLeaveBalanceDays(String(snap.leaveBalanceDays));
        setOverride(NO_OVERRIDES);
        setOverrideReason("");
      })
      .catch(() => {
        if (cancelled) return;
        setSnapshot(null);
        setSnapshotState("unavailable");
      });
    return () => { cancelled = true; };
  }, [employeeId, separationDate]);

  // GAP-PAYROLL-FNF-03: wages, 10-month average and FY-to-date salary / TDS
  // come from the employee's finalised payslips, not from typing.
  useEffect(() => {
    if (!employeeId || !separationDate) {
      setPaySnap(null);
      setPaySnapState("idle");
      return;
    }
    let cancelled = false;
    setPaySnapState("loading");
    browserJson<{ data: PaySnapshot }>(
      `v1/payroll/fnf/pay-snapshot?employeeId=${encodeURIComponent(employeeId)}&separationDate=${encodeURIComponent(separationDate)}`,
    )
      .then((res) => {
        if (cancelled) return;
        const snap = res.data;
        if (!snap?.available) {
          setPaySnap(null);
          setPaySnapState("unavailable");
          return;
        }
        setPaySnap(snap);
        setPaySnapState("loaded");
        setMoney((prev) => ({
          ...prev,
          lastDrawnWages: rupeesOfMinor(snap.lastDrawnWagesMinor),
          avgSalaryLast10Months: rupeesOfMinor(snap.avgSalaryLast10MonthsMinor),
          salaryYtd: rupeesOfMinor(snap.salaryYtdMinor),
          tdsYtd: rupeesOfMinor(snap.tdsYtdMinor),
        }));
        setFyStartYear(String(snap.fyStartYear));
        setOverride((prev) => ({ ...prev, lastDrawnWages: false, avgSalaryLast10Months: false, salaryYtd: false, tdsYtd: false }));
      })
      .catch(() => {
        if (cancelled) return;
        setPaySnap(null);
        setPaySnapState("unavailable");
      });
    return () => { cancelled = true; };
  }, [employeeId, separationDate]);

  /** What the payslips say for a pay field, as a rupee string (null when nothing was derived). */
  function derivedFor(field: PayField): string | null {
    if (!paySnap) return null;
    const minor = field === "lastDrawnWages" ? paySnap.lastDrawnWagesMinor
      : field === "avgSalaryLast10Months" ? paySnap.avgSalaryLast10MonthsMinor
      : field === "salaryYtd" ? paySnap.salaryYtdMinor
      : paySnap.tdsYtdMinor;
    return rupeesOfMinor(minor);
  }

  /** Overridden record-derived fields whose value actually differs from the records'. */
  function overriddenFields(): OverridableField[] {
    const out: OverridableField[] = [];
    if (snapshot) {
      if (override.completedYears && completedYears !== String(snapshot.completedYears)) out.push("completedYears");
      if (override.leaveBalanceDays && leaveBalanceDays !== String(snapshot.leaveBalanceDays)) out.push("leaveBalanceDays");
    }
    if (paySnap) {
      for (const f of PAY_FIELDS) {
        const derived = derivedFor(f);
        if (override[f] && derived !== null && minorFor(f) !== nonNegativeRupeesToMinorString(derived)) out.push(f);
      }
    }
    return out;
  }

  function clearInvalid(field: FieldKey) {
    if (invalidFields.has(field)) {
      setInvalidFields((prev) => {
        const next = new Set(prev);
        next.delete(field);
        return next;
      });
    }
  }

  function setMoneyField(field: MoneyField, value: string) {
    setMoney((prev) => ({ ...prev, [field]: value }));
    clearInvalid(field);
  }

  /** Paise string for a money input; blank optional fields are "0"; null = invalid. */
  function minorFor(field: MoneyField): string | null {
    const raw = money[field].trim();
    if (!raw) return REQUIRED_MONEY_FIELDS.includes(field) ? null : "0";
    return nonNegativeRupeesToMinorString(raw);
  }

  function focusField(key: FieldKey) {
    if (key === "overrideReason") reasonRef.current?.focus();
    else if ((REQUIRED_TOP_FIELDS as readonly string[]).includes(key)) {
      if (key === "employeeId") document.getElementById(empIdField)?.focus();
      else topFieldRefs.current[key as TopField]?.focus();
    } else moneyFieldRefs.current[key as MoneyField]?.focus();
  }

  function openConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setMessage(null);

    const missing = new Set<FieldKey>();
    if (!employeeId) missing.add("employeeId");
    if (!separationDate) missing.add("separationDate");
    if (!completedYears) missing.add("completedYears");
    if (!leaveBalanceDays) missing.add("leaveBalanceDays");
    if (!fyStartYear) missing.add("fyStartYear");
    for (const f of REQUIRED_MONEY_FIELDS) {
      if (!money[f].trim()) missing.add(f);
    }
    if (missing.size > 0) {
      setInvalidFields(missing);
      setError(t("requiredFieldsError"));
      const ordered: FieldKey[] = [...REQUIRED_TOP_FIELDS, ...REQUIRED_MONEY_FIELDS];
      const first = ordered.find((k) => missing.has(k));
      if (first) focusField(first);
      return;
    }

    // GAP-PAYROLL-FNF-03: every money input must be a plain rupee amount
    // with at most 2 decimals (string-parsed, no float drift); anything else
    // blocks submit rather than being silently rounded or zeroed.
    const badMoney = MONEY_FIELDS.filter((f) => minorFor(f) === null);
    if (badMoney.length > 0) {
      setInvalidFields(new Set(badMoney));
      setError(t("amountFormatError"));
      focusField(badMoney[0]!);
      return;
    }

    if (overriddenFields().length > 0 && overrideReason.trim().length < MIN_OVERRIDE_REASON) {
      setInvalidFields(new Set<FieldKey>(["overrideReason"]));
      setError(t("overrideReasonError", { min: MIN_OVERRIDE_REASON }));
      focusField("overrideReason");
      return;
    }

    // GAP-PAYROLL-FNF-05: a death settlement pays the nominee / legal heir.
    if (separationType === "death") {
      const bad = new Set<FieldKey>();
      const n = nominee;
      if (n.name.trim().length < 2) bad.add("nominee.name");
      if (!n.relationship) bad.add("nominee.relationship");
      if (!NOMINEE_ACCOUNT_RE.test(n.accountNumber.trim())) bad.add("nominee.accountNumber");
      if (!NOMINEE_IFSC_RE.test(n.ifsc.trim().toUpperCase())) bad.add("nominee.ifsc");
      if (n.documentRef.trim().length < 3) bad.add("nominee.documentRef");
      if (bad.size > 0) {
        setInvalidFields(bad);
        setError(t("nomineeInvalidError"));
        document.getElementById(`${baseId}-nominee-${[...bad][0]!.slice("nominee.".length)}`)?.focus();
        return;
      }
    }

    setInvalidFields(new Set());
    setConfirmOpen(true);
  }

  async function compute() {
    if (!employeeId) return;
    setBusy(true);
    setError(undefined);
    const m = (f: MoneyField) => minorFor(f) ?? "0";
    const overridden = overriddenFields();
    try {
      const res = await browserFetch("v1/payroll/fnf/compute", {
        method: "POST",
        body: JSON.stringify({
          employeeId,
          separationDate,
          separationType,
          employeeCategory,
          noticeBuyoutMinor: m("noticeBuyout"),
          leaveEncashmentGrossMinor: m("leaveEncashmentGross"),
          gratuityGrossMinor: m("gratuityGross"),
          retrenchmentCompMinor: m("retrenchmentComp"),
          vrsCompMinor: m("vrsComp"),
          arrearsMinor: m("arrears"),
          lastDrawnWagesMinor: m("lastDrawnWages"),
          completedYears: Number(completedYears),
          avgSalaryLast10MonthsMinor: m("avgSalaryLast10Months"),
          leaveBalanceDays: Number(leaveBalanceDays),
          priorLeaveEncashExemptionMinor: m("priorLeaveEncashExemption"),
          remainingMonthsToRetirement: Number(remainingMonthsToRetirement || "0"),
          taxRegime,
          salaryYtdMinor: m("salaryYtd"),
          tdsYtdMinor: m("tdsYtd"),
          deductions80cMinor: m("deductions80c"),
          deductions80dMinor: m("deductions80d"),
          otherDeductionsMinor: m("otherDeductions"),
          fyStartYear: Number(fyStartYear),
          ...(overridden.length > 0 ? { overrides: { fields: overridden, reason: overrideReason.trim() } } : {}),
          ...(separationType === "death" ? { nominee: {
            name: nominee.name.trim(),
            relationship: nominee.relationship,
            accountNumber: nominee.accountNumber.trim(),
            ifsc: nominee.ifsc.trim().toUpperCase(),
            documentRef: nominee.documentRef.trim(),
          } } : {}),
        }),
      });
      if (!res.ok) {
        const code = await errorCodeFromResponse(res);
        if (code === "FNF_OVERRIDE_REQUIRED") {
          setError(t("overrideRequiredServerError"));
          return;
        }
        setError(formError.fromException("save").message);
        return;
      }
      const body = (await res.json().catch(() => null)) as { data?: { message?: string } } | null;
      setConfirmOpen(false);
      setMessage(body?.data?.message ?? t("computeQueuedMessage"));
      router.refresh();
      setPollTicks(0);
      setPolling(true);
    } catch {
      setError(formError.fromException("save").message);
    } finally {
      setBusy(false);
    }
  }

  const inputStyle = { padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 } as const;
  const lockedStyle = { ...inputStyle, background: "var(--panel)" } as const;
  const overridden = overriddenFields();

  function overridableInput(field: HrField, id: string, labelKey: string, value: string, setValue: (v: string) => void) {
    const locked = snapshot !== null && !override[field];
    return (
      <div style={{ display: "grid", gap: 6 }}>
        <label htmlFor={id} style={{ fontSize: 13, fontWeight: 600 }}>
          {t(labelKey)} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
        </label>
        <input
          id={id}
          ref={(el) => { topFieldRefs.current[field] = el; }}
          type="number"
          min={0}
          step={field === "leaveBalanceDays" ? 0.5 : 1}
          value={value}
          readOnly={locked}
          onChange={(e) => { setValue(e.target.value); clearInvalid(field); }}
          aria-required="true"
          aria-invalid={invalidFields.has(field) || undefined}
          aria-describedby={invalidFields.has(field) ? errId : undefined}
          style={locked ? lockedStyle : inputStyle}
        />
        {snapshot && (
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "var(--ink2)" }}>
            <input
              type="checkbox"
              checked={override[field]}
              onChange={(e) => {
                const on = e.target.checked;
                setOverride((prev) => ({ ...prev, [field]: on }));
                if (!on) setValue(String(snapshot[field]));
              }}
            />
            {t("overrideToggle", { value: snapshot[field] })}
          </label>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={openConfirm} style={{ marginBottom: 16 }}>
      <Card title={t("formTitle")} padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={empIdField} style={{ fontSize: 13, fontWeight: 600 }}>
                {t("employeeLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              {/* GAP-PAYROLL-FNF-05: was a raw "Employee ID (UUID)" text box. */}
              <EntityPicker
                id={empIdField}
                value={employeeId}
                onChange={(v) => { setEmployeeId(typeof v === "string" ? v : null); clearInvalid("employeeId"); }}
                search={searchAndRemember}
                placeholder={t("employeePlaceholder")}
              />
              {directoryForbidden && (
                <p role="alert" className="pill warn" style={{ width: "fit-content", margin: 0, fontSize: 12 }}>
                  {t("directoryForbidden")}
                </p>
              )}
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={dateField} style={{ fontSize: 13, fontWeight: 600 }}>
                {t("separationDateLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={dateField}
                ref={(el) => { topFieldRefs.current.separationDate = el; }}
                type="date"
                value={separationDate}
                onChange={(e) => { setSeparationDate(e.target.value); clearInvalid("separationDate"); }}
                aria-required="true"
                aria-invalid={invalidFields.has("separationDate") || undefined}
                aria-describedby={invalidFields.has("separationDate") ? errId : undefined}
                style={inputStyle}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={sepTypeField} style={{ fontSize: 13, fontWeight: 600 }}>{t("separationTypeLabel")}</label>
              <select id={sepTypeField} value={separationType} onChange={(e) => setSeparationType(e.target.value as (typeof SEPARATION_TYPES)[number])} style={inputStyle}>
                {SEPARATION_TYPES.map((v) => <option key={v} value={v}>{SEPARATION_TYPE_LABELS[v]}</option>)}
              </select>
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={catField} style={{ fontSize: 13, fontWeight: 600 }}>{t("employeeCategoryLabel")}</label>
              <select id={catField} value={employeeCategory} onChange={(e) => setEmployeeCategory(e.target.value as (typeof EMPLOYEE_CATEGORIES)[number])} style={inputStyle}>
                {EMPLOYEE_CATEGORIES.map((c) => <option key={c} value={c}>{EMPLOYEE_CATEGORY_LABELS[c]}</option>)}
              </select>
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={regimeField} style={{ fontSize: 13, fontWeight: 600 }}>{t("taxRegimeLabel")}</label>
              <select id={regimeField} value={taxRegime} onChange={(e) => setTaxRegime(e.target.value as "old" | "new")} style={inputStyle}>
                <option value="old">{t("taxRegimeOld")}</option>
                <option value="new">{t("taxRegimeNew")}</option>
              </select>
            </div>
            {overridableInput("completedYears", yearsField, "completedYearsLabel", completedYears, setCompletedYears)}
            {overridableInput("leaveBalanceDays", leaveField, "leaveBalanceLabel", leaveBalanceDays, setLeaveBalanceDays)}
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={remainingField} style={{ fontSize: 13, fontWeight: 600 }}>{t("remainingMonthsLabel")}</label>
              <input id={remainingField} type="number" min={0} value={remainingMonthsToRetirement} onChange={(e) => setRemainingMonthsToRetirement(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={fyField} style={{ fontSize: 13, fontWeight: 600 }}>
                {t("fyStartYearLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={fyField}
                ref={(el) => { topFieldRefs.current.fyStartYear = el; }}
                type="number"
                value={fyStartYear}
                onChange={(e) => { setFyStartYear(e.target.value); clearInvalid("fyStartYear"); }}
                aria-required="true"
                aria-invalid={invalidFields.has("fyStartYear") || undefined}
                aria-describedby={invalidFields.has("fyStartYear") ? errId : undefined}
                style={inputStyle}
              />
            </div>
          </div>

          {snapshotState === "loading" && <p role="status" style={{ margin: 0, fontSize: 12, color: "var(--ink2)" }}>{t("hrRecordsLoading")}</p>}
          {snapshotState === "loaded" && <p role="status" style={{ margin: 0, fontSize: 12, color: "var(--ink2)" }}>{t("hrRecordsLoaded")}</p>}
          {snapshotState === "unavailable" && <p role="status" className="pill warn" style={{ width: "fit-content", margin: 0 }}>{t("hrRecordsUnavailable")}</p>}
          {paySnapState === "loading" && <p role="status" style={{ margin: 0, fontSize: 12, color: "var(--ink2)" }}>{t("payRecordsLoading")}</p>}
          {paySnapState === "loaded" && paySnap && <p role="status" style={{ margin: 0, fontSize: 12, color: "var(--ink2)" }}>{t("payRecordsLoaded", { months: paySnap.ytdMonths })}</p>}
          {paySnapState === "unavailable" && <p role="status" className="pill warn" style={{ width: "fit-content", margin: 0 }}>{t("payRecordsUnavailable")}</p>}

          {overridden.length > 0 && (
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={reasonField} style={{ fontSize: 13, fontWeight: 600 }}>
                {t("overrideReasonLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <textarea
                id={reasonField}
                ref={reasonRef}
                value={overrideReason}
                onChange={(e) => { setOverrideReason(e.target.value); clearInvalid("overrideReason"); }}
                rows={2}
                maxLength={500}
                aria-required="true"
                aria-invalid={invalidFields.has("overrideReason") || undefined}
                aria-describedby={invalidFields.has("overrideReason") ? errId : undefined}
                style={{ ...inputStyle, minHeight: 64 }}
              />
            </div>
          )}

          <fieldset style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 14 }}>
            <legend style={{ fontSize: 13, fontWeight: 700, padding: "0 6px" }}>{t("amountsLegend")}</legend>
            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
              {MONEY_FIELDS.map((f) => {
                const id = `${baseId}-${f}`;
                const required = REQUIRED_MONEY_FIELDS.includes(f);
                const invalid = invalidFields.has(f);
                // GAP-PAYROLL-FNF-03: derived from payslips -> read-only until overridden.
                const payField: PayField | null = paySnap !== null && (PAY_FIELDS as readonly string[]).includes(f) ? (f as PayField) : null;
                const lockedPay = payField !== null && !override[payField];
                const hint = snapshot
                  ? f === "gratuityGross" ? snapshot.gratuityEstimateMinor
                  : f === "leaveEncashmentGross" ? snapshot.leaveEncashmentEstimateMinor
                  : f === "lastDrawnWages" ? snapshot.basicMonthlyMinor
                  : null
                  : null;
                return (
                  <div key={f} style={{ display: "grid", gap: 6 }}>
                    <label htmlFor={id} style={{ fontSize: 13, fontWeight: 600 }}>
                      {MONEY_LABELS[f]} {required && <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>}
                    </label>
                    <input
                      id={id}
                      ref={(el) => { moneyFieldRefs.current[f] = el; }}
                      type="text"
                      inputMode="decimal"
                      value={money[f]}
                      readOnly={lockedPay}
                      onChange={(e) => setMoneyField(f, e.target.value)}
                      aria-required={required}
                      aria-invalid={invalid || undefined}
                      aria-describedby={invalid ? errId : undefined}
                      style={lockedPay ? lockedStyle : inputStyle}
                    />
                    {payField && (
                      <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "var(--ink2)" }}>
                        <input
                          type="checkbox"
                          checked={override[payField]}
                          onChange={(e) => {
                            const on = e.target.checked;
                            setOverride((prev) => ({ ...prev, [payField]: on }));
                            if (!on) setMoneyField(f, derivedFor(payField) ?? "");
                          }}
                        />
                        {t("payOverrideToggle", { value: formatMoney(nonNegativeRupeesToMinorString(derivedFor(payField) ?? "0") ?? "0") })}
                      </label>
                    )}
                    {hint !== null && (
                      <span style={{ fontSize: 12, color: "var(--ink2)" }}>{t("systemEstimateHint", { amount: formatMoney(hint) })}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </fieldset>

          {separationType === "death" && (
            <fieldset style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 14 }}>
              <legend style={{ fontSize: 13, fontWeight: 700, padding: "0 6px" }}>{t("nomineeLegend")}</legend>
              <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--ink2)" }}>{t("nomineeIntro")}</p>
              <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
                {([
                  ["name", "nomineeNameLabel", "text"],
                  ["relationship", "nomineeRelationshipLabel", "select"],
                  ["accountNumber", "nomineeAccountLabel", "account"],
                  ["ifsc", "nomineeIfscLabel", "text"],
                  ["documentRef", "nomineeDocumentLabel", "text"],
                ] as const).map(([field, labelKey, kind]) => {
                  const id = `${baseId}-nominee-${field}`;
                  const invalid = invalidFields.has(`nominee.${field}`);
                  const common = {
                    id,
                    "aria-required": true as const,
                    "aria-invalid": invalid || undefined,
                    "aria-describedby": invalid ? errId : undefined,
                    style: inputStyle,
                  };
                  return (
                    <div key={field} style={{ display: "grid", gap: 6 }}>
                      <label htmlFor={id} style={{ fontSize: 13, fontWeight: 600 }}>
                        {t(labelKey)} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
                      </label>
                      {kind === "select" ? (
                        <select {...common} value={nominee.relationship} onChange={(e) => { setNominee((p) => ({ ...p, relationship: e.target.value })); clearInvalid("nominee.relationship"); }}>
                          <option value="">{t("nomineeRelationshipPlaceholder")}</option>
                          {NOMINEE_RELATIONSHIPS.map((r) => <option key={r} value={r}>{t(`nomineeRelationship_${r}`)}</option>)}
                        </select>
                      ) : (
                        <input
                          {...common}
                          type="text"
                          inputMode={kind === "account" ? "numeric" : undefined}
                          autoComplete="off"
                          maxLength={field === "ifsc" ? 11 : field === "accountNumber" ? 18 : 128}
                          value={nominee[field]}
                          onChange={(e) => { setNominee((p) => ({ ...p, [field]: e.target.value })); clearInvalid(`nominee.${field}`); }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </fieldset>
          )}

          <div>
            <Button type="submit" style={{ minHeight: 44 }} disabled={busy}>
              {t("computeSettlementBtn")}
            </Button>
          </div>

          {error && !confirmOpen && (
            <p id={errId} role="alert" className="pill bad" style={{ width: "fit-content" }}>{error}</p>
          )}
          {message && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <p role="status" className="pill good" style={{ width: "fit-content", margin: 0 }}>{message}</p>
              <Button type="button" variant="ghost" onClick={() => router.refresh()}>{t("refreshListBtn")}</Button>
            </div>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title={t("confirmTitle")}
        danger
        confirmLabel={t("confirmLabel")}
        busy={busy}
        errorMessage={error}
        description={
          <>
            {t.rich("confirmDescription", {
              employee: employeeLabel,
              separationType: SEPARATION_TYPE_LABELS[separationType],
              separationDate: formatIndianDate(separationDate),
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
            {overridden.length > 0 && (
              <ul style={{ margin: "8px 0 0", paddingInlineStart: 18 }}>
                {overridden.map((f) => {
                  const isPay = (PAY_FIELDS as readonly string[]).includes(f);
                  return (
                    <li key={f}>
                      {t("confirmOverrideLine", {
                        field: isPay ? MONEY_LABELS[f as PayField]
                          : t(f === "completedYears" ? "completedYearsLabel" : "leaveBalanceLabel"),
                        system: isPay ? formatMoney(nonNegativeRupeesToMinorString(derivedFor(f as PayField) ?? "0") ?? "0") : snapshot ? snapshot[f as "completedYears" | "leaveBalanceDays"] : "",
                        entered: isPay ? formatMoney(minorFor(f as PayField) ?? "0") : f === "completedYears" ? completedYears : leaveBalanceDays,
                      })}
                    </li>
                  );
                })}
              </ul>
            )}
            {separationType === "death" && (
              <p style={{ margin: "8px 0 0" }}>
                {t("confirmNomineeLine", {
                  name: nominee.name.trim(),
                  relationship: nominee.relationship ? t(`nomineeRelationship_${nominee.relationship}`) : "",
                  last4: nominee.accountNumber.trim().slice(-4),
                })}
              </p>
            )}
          </>
        }
        onConfirm={() => void compute()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
