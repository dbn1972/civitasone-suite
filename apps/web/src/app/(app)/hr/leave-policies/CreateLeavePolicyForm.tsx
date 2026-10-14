"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card, ConfirmDialog, Button, Field, Input, Select } from "../../../_components/ds";
import { useFormError } from "@/lib/useFormError";
import { translateFormErrors } from "../_components/translateFormErrors";
import { validateLeavePolicy, type LeavePolicyErrors } from "./leavePolicySchema";

type LeaveType = { id: string; code: string; name: string };

const EMPLOYEE_TYPE_VALUES = [
  "permanent", "contractual", "vendor_deputed", "deputation", "consultant",
  "temporary", "intern", "apprentice", "volunteer",
];

const COUNT_METHOD_VALUES = ["calendar", "working_days"];

const SR_ONLY: React.CSSProperties = {
  position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden",
  clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", border: 0,
};

export function CreateLeavePolicyForm({ onCreated }: { onCreated?: () => void } = {}) {
  const t = useTranslations("leavePolicyForm");
  const tv = useTranslations("hrFormErrors");
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

  const errId = useId();
  const [clientErrors, setClientErrors] = useState<LeavePolicyErrors>({});
  /** Client validation first, then a backend rejection for the same field. */
  const errFor = (f: keyof LeavePolicyErrors) => clientErrors[f] ?? formError.fieldError(f);
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
    formError.clear();
    const errs = translateFormErrors(validateLeavePolicy({
      leaveTypeId,
      employeeType,
      maxDaysPerYear: Number(maxDaysPerYear),
      countMethod,
      maxAccumulation: Number(maxAccumulation),
      maxContinuousDays: Number(maxContinuousDays),
      minServiceMonths: Number(minServiceMonths),
      genderRestriction,
      requiresMedicalCertAfterDays: Number(requiresMedicalCertAfterDays),
    }), tv);
    setClientErrors(errs);
    const msg = validate() ?? (Object.keys(errs).length > 0 ? Object.values(errs)[0]! : null);
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
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
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
              <Field label={t("leaveTypeLabel")} required error={errFor("leaveTypeId")}>
                <Select
                  ref={ltRef}
                  value={leaveTypeId}
                  disabled={ltLoading}
                  onChange={(e) => setLeaveTypeId(e.target.value)}
                >
                  {ltLoading && <option value="">{t("loadingLeaveTypes")}</option>}
                  {!ltLoading && leaveTypes.length === 0 && <option value="">{t("noLeaveTypesAvailable")}</option>}
                  {leaveTypes.map((lt) => (
                    <option key={lt.id} value={lt.id}>{lt.code} — {lt.name}</option>
                  ))}
                </Select>
              </Field>

              <Field label={t("employeeTypeLabel")} required error={errFor("employeeType")}>
                <Select value={employeeType} onChange={(e) => setEmployeeType(e.target.value)}>
                  {employeeTypeOptions.map((et) => (
                    <option key={et.value} value={et.value}>{et.label}</option>
                  ))}
                </Select>
              </Field>

              <Field label={t("daysPerYearLabel")} required error={errFor("maxDaysPerYear")}>
                <Input
                  type="number"
                  min={0}
                  max={730}
                  value={maxDaysPerYear}
                  onChange={(e) => setMaxDaysPerYear(e.target.value)}
                />
              </Field>

              <Field label={t("countMethodLabel")} error={errFor("countMethod")}>
                <Select value={countMethod} onChange={(e) => setCountMethod(e.target.value)}>
                  {countMethodOptions.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </Select>
              </Field>
            </div>

            <details style={{ marginTop: 16 }}>
              <summary style={{ fontSize: 13, fontWeight: 600, cursor: "pointer", color: "var(--primary-d)", userSelect: "none" }}>
                {t("advancedSettings")}
              </summary>
              <div style={{ marginTop: 12, display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                <Field label={t("maxAccumulationLabel")} error={errFor("maxAccumulation")}>
                  <Input
                    type="number" min={0}
                    value={maxAccumulation}
                    onChange={(e) => setMaxAccumulation(e.target.value)}
                  />
                </Field>
                <Field label={t("maxContinuousLabel")} error={errFor("maxContinuousDays")}>
                  <Input
                    type="number" min={1} max={730}
                    value={maxContinuousDays}
                    onChange={(e) => setMaxContinuousDays(e.target.value)}
                  />
                </Field>
                <Field label={t("minServiceLabel")} error={errFor("minServiceMonths")}>
                  <Input
                    type="number" min={0}
                    value={minServiceMonths}
                    onChange={(e) => setMinServiceMonths(e.target.value)}
                  />
                </Field>
                <Field label={t("genderRestrictionLabel")} error={errFor("genderRestriction")}>
                  <Select
                    value={genderRestriction}
                    onChange={(e) => setGenderRestriction(e.target.value as "" | "male" | "female")}
                  >
                    <option value="">{t("genderNone")}</option>
                    <option value="female">{t("genderFemaleOnly")}</option>
                    <option value="male">{t("genderMaleOnly")}</option>
                  </Select>
                </Field>
                <Field label={t("medCertDaysLabel")} error={errFor("requiresMedicalCertAfterDays")}>
                  <Input
                    type="number" min={1}
                    value={requiresMedicalCertAfterDays}
                    onChange={(e) => setRequiresMedicalCertAfterDays(e.target.value)}
                  />
                </Field>
              </div>

              <fieldset style={{ display: "flex", flexWrap: "wrap", gap: 20, border: 0, margin: "12px 0 0", padding: 0, minWidth: 0 }}>
                <legend style={SR_ONLY}>{t("advancedSettings")}</legend>
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
              </fieldset>
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
              // GAP-HR-LEAVE-POLICIES-07: use the same employeeTypes i18n
              // map the form's own <select> options already use (line 47)
              // instead of a raw replace(/_/g,' ') that bypasses translation
              // and only substitutes the first underscore anyway.
              employeeType: t(`employeeTypes.${employeeType}`),
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
