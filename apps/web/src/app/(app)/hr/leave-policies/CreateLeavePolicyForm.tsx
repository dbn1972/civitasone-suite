"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card, ConfirmDialog, Button } from "../../../_components/ds";
import { useFormError } from "@/lib/useFormError";

type LeaveType = { id: string; code: string; name: string };

const EMPLOYEE_TYPE_VALUES = [
  "permanent", "contractual", "vendor_deputed", "deputation", "consultant",
  "temporary", "intern", "apprentice", "volunteer",
];

const COUNT_METHOD_VALUES = ["calendar", "working_days"];

export function CreateLeavePolicyForm({ onCreated }: { onCreated?: () => void } = {}) {
  const t = useTranslations("leavePolicyForm");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [ltLoading, setLtLoading] = useState(false);

  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [employeeType, setEmployeeType] = useState("permanent");
  const [maxDaysPerYear, setMaxDaysPerYear] = useState("30");
  const [carryForward, setCarryForward] = useState(false);
  const [maxAccumulation, setMaxAccumulation] = useState("0");
  const [encashable, setEncashable] = useState(false);
  const [countMethod, setCountMethod] = useState("calendar");
  const [maxContinuousDays, setMaxContinuousDays] = useState("365");
  const [minServiceMonths, setMinServiceMonths] = useState("0");
  const [genderRestriction, setGenderRestriction] = useState<"" | "male" | "female">("");
  const [requiresMedicalCert, setRequiresMedicalCert] = useState(false);
  const [requiresMedicalCertAfterDays, setRequiresMedicalCertAfterDays] = useState("3");
  const [prefixSuffixRule, setPrefixSuffixRule] = useState(false);
  const [sandwichRule, setSandwichRule] = useState(false);
  const [proRataOnJoining, setProRataOnJoining] = useState(true);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [fieldError, setFieldError] = useState<string | null>(null);
  const formError = useFormError("leave policy");

  const employeeTypeOptions = EMPLOYEE_TYPE_VALUES.map((value) => ({ value, label: t(`employeeTypes.${value}`) }));
  const countMethodOptions = COUNT_METHOD_VALUES.map((value) => ({ value, label: t(`countMethods.${value}`) }));

  const ltField = useId();
  const empField = useId();
  const daysField = useId();
  const errId = useId();
  const countMethodField = useId();
  const maxAccumField = useId();
  const maxContField = useId();
  const minServiceField = useId();
  const genderField = useId();
  const medCertDaysField = useId();
  const ltRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (!open || leaveTypes.length > 0) return;
    setLtLoading(true);
    const controller = new AbortController();
    fetch("/api/proxy/v1/hrms/leave-types", { signal: controller.signal })
      .then((r) => r.json())
      .then((body: unknown) => {
        const arr = Array.isArray(body) ? body : (body as { data?: LeaveType[] })?.data ?? [];
        setLeaveTypes(arr as LeaveType[]);
        if ((arr as LeaveType[])[0]) setLeaveTypeId((arr as LeaveType[])[0].id);
      })
      .catch((err) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setFieldError(t("couldNotLoadLeaveTypes"));
      })
      .finally(() => setLtLoading(false));
    return () => controller.abort();
    // `t` must be a real dependency: it's captured in the .catch() closure
    // below, and next-intl hands out a new `t` whenever the locale changes.
    // Without it here, a locale switch while this panel happened to be open
    // left the load-failure message frozen in whatever language was active
    // when the effect last ran -- everything else on screen re-renders in
    // the new locale, just not this one error string. Safe to add: the
    // `leaveTypes.length > 0` guard above means a `t`-driven re-run past the
    // first successful load is always a no-op, not a refetch loop.
  }, [open, leaveTypes.length, t]);

  function validate() {
    if (!leaveTypeId) return t("selectLeaveTypeRequired");
    if (!employeeType) return t("selectEmployeeTypeRequired");
    const days = Number(maxDaysPerYear);
    if (!Number.isInteger(days) || days < 0 || days > 730) return t("daysRangeError");
    return null;
  }

  function openConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    const msg = validate();
    if (msg) { setFieldError(msg); return; }
    setFieldError(null);
    setConfirmOpen(true);
  }

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch("/api/proxy/v1/hrms/admin/leave-policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leaveTypeId,
          employeeType,
          maxDaysPerYear: Number(maxDaysPerYear),
          carryForward,
          maxAccumulation: Number(maxAccumulation),
          encashable,
          countMethod,
          maxContinuousDays: Number(maxContinuousDays),
          minServiceMonths: Number(minServiceMonths),
          genderRestriction: genderRestriction || null,
          requiresMedicalCert,
          requiresMedicalCertAfterDays: Number(requiresMedicalCertAfterDays),
          prefixSuffixRule,
          sandwichRule,
          proRataOnJoining,
        }),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setError(resolved.message);
        return;
      }
      setConfirmOpen(false);
      setOpen(false);
      // POST /v1/hrms/admin/leave-policies is a fire-and-forget queued write
      // (see policy-admin-routes.ts) — router.refresh() alone would not
      // re-run this page's client-side fetchPolicies() effect, since the page
      // is a "use client" component with its own useEffect-driven fetch, not
      // a server component. Let the parent re-fetch its list explicitly.
      onCreated?.();
      router.refresh();
    } catch {
      setError(formError.fromException("save").message);
    } finally {
      setBusy(false);
    }
  }

  const selectedLt = leaveTypes.find((l) => l.id === leaveTypeId);

  return (
    <div style={{ marginBottom: 16 }}>
      {!open ? (
        <Button onClick={() => setOpen(true)}>
          {t("newPolicyBtn")}
        </Button>
      ) : (
        <form onSubmit={openConfirm} noValidate>
          <Card title={t("formTitle")} padding>
            {fieldError && (
              <p id={errId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 13, marginBottom: 12 }}>
                {fieldError}
              </p>
            )}

            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
              <div style={{ display: "grid", gap: 6 }}>
                <label htmlFor={ltField} style={{ fontSize: 13, fontWeight: 600 }}>
                  {t("leaveTypeLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
                </label>
                {ltLoading ? (
                  <p style={{ fontSize: 13, color: "var(--mut)" }}>{t("loadingLeaveTypes")}</p>
                ) : (
                  <select
                    id={ltField}
                    ref={ltRef}
                    value={leaveTypeId}
                    onChange={(e) => setLeaveTypeId(e.target.value)}
                    style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 }}
                  >
                    {leaveTypes.length === 0 && <option value="">{t("noLeaveTypesAvailable")}</option>}
                    {leaveTypes.map((lt) => (
                      <option key={lt.id} value={lt.id}>{lt.code} — {lt.name}</option>
                    ))}
                  </select>
                )}
              </div>

              <div style={{ display: "grid", gap: 6 }}>
                <label htmlFor={empField} style={{ fontSize: 13, fontWeight: 600 }}>
                  {t("employeeTypeLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
                </label>
                <select
                  id={empField}
                  value={employeeType}
                  onChange={(e) => setEmployeeType(e.target.value)}
                  style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 }}
                >
                  {employeeTypeOptions.map((et) => (
                    <option key={et.value} value={et.value}>{et.label}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: "grid", gap: 6 }}>
                <label htmlFor={daysField} style={{ fontSize: 13, fontWeight: 600 }}>
                  {t("daysPerYearLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
                </label>
                <input
                  id={daysField}
                  type="number"
                  min={0}
                  max={730}
                  value={maxDaysPerYear}
                  onChange={(e) => setMaxDaysPerYear(e.target.value)}
                  style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 }}
                />
              </div>

              <div style={{ display: "grid", gap: 6 }}>
                <label htmlFor={countMethodField} style={{ fontSize: 13, fontWeight: 600 }}>{t("countMethodLabel")}</label>
                <select
                  id={countMethodField}
                  value={countMethod}
                  onChange={(e) => setCountMethod(e.target.value)}
                  style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 }}
                >
                  {countMethodOptions.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <details style={{ marginTop: 16 }}>
              <summary style={{ fontSize: 13, fontWeight: 600, cursor: "pointer", color: "var(--primary-d)", userSelect: "none" }}>
                {t("advancedSettings")}
              </summary>
              <div style={{ marginTop: 12, display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                <div style={{ display: "grid", gap: 6 }}>
                  <label htmlFor={maxAccumField} style={{ fontSize: 13, fontWeight: 600 }}>{t("maxAccumulationLabel")}</label>
                  <input
                    id={maxAccumField}
                    type="number" min={0}
                    value={maxAccumulation}
                    onChange={(e) => setMaxAccumulation(e.target.value)}
                    style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 }}
                  />
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  <label htmlFor={maxContField} style={{ fontSize: 13, fontWeight: 600 }}>{t("maxContinuousLabel")}</label>
                  <input
                    id={maxContField}
                    type="number" min={1} max={730}
                    value={maxContinuousDays}
                    onChange={(e) => setMaxContinuousDays(e.target.value)}
                    style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 }}
                  />
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  <label htmlFor={minServiceField} style={{ fontSize: 13, fontWeight: 600 }}>{t("minServiceLabel")}</label>
                  <input
                    id={minServiceField}
                    type="number" min={0}
                    value={minServiceMonths}
                    onChange={(e) => setMinServiceMonths(e.target.value)}
                    style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 }}
                  />
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  <label htmlFor={genderField} style={{ fontSize: 13, fontWeight: 600 }}>{t("genderRestrictionLabel")}</label>
                  <select
                    id={genderField}
                    value={genderRestriction}
                    onChange={(e) => setGenderRestriction(e.target.value as "" | "male" | "female")}
                    style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 }}
                  >
                    <option value="">{t("genderNone")}</option>
                    <option value="female">{t("genderFemaleOnly")}</option>
                    <option value="male">{t("genderMaleOnly")}</option>
                  </select>
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  <label htmlFor={medCertDaysField} style={{ fontSize: 13, fontWeight: 600 }}>{t("medCertDaysLabel")}</label>
                  <input
                    id={medCertDaysField}
                    type="number" min={1}
                    value={requiresMedicalCertAfterDays}
                    onChange={(e) => setRequiresMedicalCertAfterDays(e.target.value)}
                    style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 }}
                  />
                </div>
              </div>

              <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 20 }}>
                {[
                  { id: "carryForward", label: t("checkCarryForward"), value: carryForward, set: setCarryForward },
                  { id: "encashable", label: t("checkEncashable"), value: encashable, set: setEncashable },
                  { id: "requiresMedicalCert", label: t("checkRequiresMedCert"), value: requiresMedicalCert, set: setRequiresMedicalCert },
                  { id: "prefixSuffixRule", label: t("checkPrefixSuffix"), value: prefixSuffixRule, set: setPrefixSuffixRule },
                  { id: "sandwichRule", label: t("checkSandwich"), value: sandwichRule, set: setSandwichRule },
                  { id: "proRataOnJoining", label: t("checkProRata"), value: proRataOnJoining, set: setProRataOnJoining },
                ].map(({ id, label, value, set }) => (
                  <label key={id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={value}
                      onChange={(e) => set(e.target.checked)}
                      style={{ width: 16, height: 16, accentColor: "var(--primary-d)" }}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </details>

            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <Button type="submit">
                {t("createPolicyBtn")}
              </Button>
              <Button variant="ghost" onClick={() => { setOpen(false); setFieldError(null); }}>
                {t("cancelBtn")}
              </Button>
            </div>
          </Card>
        </form>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={t("confirmCreateTitle")}
        confirmLabel={t("confirmCreateLabel")}
        busy={busy}
        errorMessage={error}
        description={
          selectedLt ? (
            t.rich("confirmCreateDescRich", {
              leaveType: selectedLt.name,
              employeeType: employeeType.replace(/_/g, " "),
              days: maxDaysPerYear,
              strongType: (chunks) => <strong>{chunks}</strong>,
              strongEmp: (chunks) => <strong style={{ textTransform: "capitalize" }}>{chunks}</strong>,
              strongDays: (chunks) => <strong>{chunks}</strong>,
            })
          ) : (
            t("confirmCreateDescDefault")
          )
        }
        onConfirm={() => void save()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </div>
  );
}
