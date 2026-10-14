"use client";

/**
 * GAP-HR-EMPLOYEE-TYPES-01: the master was read-only -- the only documented
 * way to add a type was a raw `POST /v1/hrms/employee-types` API path shown
 * to HR staff in the page's own copy, with no UI behind it at all. This
 * form covers both create (/hr/employee-types/new) and edit
 * (/hr/employee-types/[id]/edit), mirroring createBody/updateBody in
 * employee-types-routes.ts field for field.
 *
 * HUMAN REVIEW (statutory/payroll-adjacent): these flags (statutory PF/ESI/
 * NPS, tax section, payment route) drive real statutory deduction and TDS
 * behaviour for every employee assigned this type. The form is restricted to
 * hr_admin/super_admin/admin (mirrors employee-types-routes.ts's own
 * HR_ROLES for POST/PATCH) both by the pages that render it and by the
 * backend route itself, but a mis-set flag here has payroll-compliance
 * consequences, not just a display bug -- worth a second look before merge.
 */
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Field, Input, Select, Textarea } from "../../../../_components/ds";
import { translateHrErrors } from "../../_components/translateHrErrors";
import { validateEmployeeType, type EmployeeTypeErrors } from "./employeeTypeSchema";
import { useFormError } from "@/lib/useFormError";

export type EmployeeTypeFormValues = {
  code: string;
  name: string;
  description: string;
  payMode: string;
  category: string;
  paymentRoute: string;
  taxSection: string;
  defaultProbationMonths: number;
  maxContractMonths: number | null;
  statutoryPf: boolean;
  statutoryEsi: boolean;
  statutoryNps: boolean;
  eligibleForGratuity: boolean;
  eligibleForBonus: boolean;
  leaveEncashment: boolean;
  eligibleForLeave: boolean;
  eligibleForPayroll: boolean;
  eligibleForAppraisal: boolean;
};

const DEFAULTS: EmployeeTypeFormValues = {
  code: "", name: "", description: "",
  payMode: "monthly", category: "other", paymentRoute: "payroll", taxSection: "192",
  defaultProbationMonths: 0, maxContractMonths: null,
  statutoryPf: true, statutoryEsi: true, statutoryNps: true,
  eligibleForGratuity: true, eligibleForBonus: false, leaveEncashment: true,
  eligibleForLeave: true, eligibleForPayroll: true, eligibleForAppraisal: true,
};

const checkboxRow: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, fontSize: 13.5 };

interface Props {
  mode: "create" | "edit";
  id?: string;
  initial?: Partial<EmployeeTypeFormValues>;
}

export function EmployeeTypeForm({ mode, id, initial }: Props) {
  const t = useTranslations("employeeTypes");
  const tv = useTranslations("hrFormErrors2");
  const ids = {
    code: useId(), name: useId(), description: useId(), payMode: useId(), category: useId(),
    paymentRoute: useId(), taxSection: useId(), probation: useId(), maxContract: useId(),
  };
  const [fields, setFields] = useState<EmployeeTypeFormValues>({ ...DEFAULTS, ...initial });
  const [errors, setErrors] = useState<EmployeeTypeErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const formError = useFormError("employee type");

  function set<K extends keyof EmployeeTypeFormValues>(key: K, value: EmployeeTypeFormValues[K]) {
    setFields((f) => ({ ...f, [key]: value }));
    setErrors((e) => { if (!(key in e)) return e; const n = { ...e }; delete n[key as keyof EmployeeTypeErrors]; return n; });
  }

  function validate(): boolean {
    const errs = translateHrErrors(validateEmployeeType(fields), tv);
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setBusy(true);
    setMessage(null);
    formError.clear();
    const body: Record<string, unknown> = {
      code: fields.code.trim(),
      name: fields.name.trim(),
      description: fields.description.trim() || undefined,
      payMode: fields.payMode,
      category: fields.category,
      paymentRoute: fields.paymentRoute,
      taxSection: fields.taxSection,
      defaultProbationMonths: fields.defaultProbationMonths,
      ...(fields.maxContractMonths ? { maxContractMonths: fields.maxContractMonths } : {}),
      statutoryPf: fields.statutoryPf,
      statutoryEsi: fields.statutoryEsi,
      statutoryNps: fields.statutoryNps,
      eligibleForGratuity: fields.eligibleForGratuity,
      eligibleForBonus: fields.eligibleForBonus,
      leaveEncashment: fields.leaveEncashment,
      eligibleForLeave: fields.eligibleForLeave,
      eligibleForPayroll: fields.eligibleForPayroll,
      eligibleForAppraisal: fields.eligibleForAppraisal,
    };
    try {
      const url = mode === "create" ? "/api/proxy/v1/hrms/employee-types" : `/api/proxy/v1/hrms/employee-types/${id}`;
      const res = await fetch(url, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setMessage(resolved.message);
        return;
      }
      router.push("/hr/employee-types");
      router.refresh();
    } catch (caught) {
      setMessage(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate style={{ display: "grid", gap: 16, maxWidth: 640 }}>
      {message && (
        <p role="alert" className="pill bad" style={{ margin: 0 }}>{message}</p>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 14 }}>
        <Field id={ids.code} label={t("fieldCode")} required error={errors.code}>
          <Input
            value={fields.code}
            onChange={(e) => set("code", e.target.value)}
            maxLength={24}
            disabled={mode === "edit"}
          />
        </Field>
        <Field id={ids.name} label={t("fieldName")} required error={errors.name}>
          <Input
            value={fields.name}
            onChange={(e) => set("name", e.target.value)}
            maxLength={120}
          />
        </Field>
      </div>

      <Field id={ids.description} label={t("fieldDescription")} error={errors.description}>
        <Textarea
          value={fields.description}
          onChange={(e) => set("description", e.target.value)}
          maxLength={500}
          rows={2}
          style={{ resize: "vertical" }}
        />
      </Field>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14 }}>
        <Field id={ids.payMode} label={t("fieldPayMode")}>
          <Select value={fields.payMode} onChange={(e) => set("payMode", e.target.value)}>
            {["monthly", "hourly", "consolidated", "stipend", "none"].map((v) => (
              <option key={v} value={v}>{t(`payMode${v.charAt(0).toUpperCase()}${v.slice(1)}`)}</option>
            ))}
          </Select>
        </Field>
        <Field id={ids.category} label={t("fieldCategory")}>
          <Select value={fields.category} onChange={(e) => set("category", e.target.value)}>
            {["pay_scale", "contractual", "consultant", "third_party", "apprentice", "other"].map((v) => (
              <option key={v} value={v}>{t(`category.${v}`)}</option>
            ))}
          </Select>
        </Field>
        <Field id={ids.paymentRoute} label={t("fieldPaymentRoute")}>
          <Select value={fields.paymentRoute} onChange={(e) => set("paymentRoute", e.target.value)}>
            {["payroll", "invoice", "agency", "stipend", "none"].map((v) => (
              <option key={v} value={v}>{t(`paymentRoute.${v}`)}</option>
            ))}
          </Select>
        </Field>
        <Field id={ids.taxSection} label={t("fieldTaxSection")}>
          <Select value={fields.taxSection} onChange={(e) => set("taxSection", e.target.value)}>
            {["192", "194J", "194C", "stipend", "none"].map((v) => (
              <option key={v} value={v}>{v === "none" ? t("none") : v}</option>
            ))}
          </Select>
        </Field>
        <Field id={ids.probation} label={t("fieldProbationMonths")} error={errors.defaultProbationMonths}>
          <Input
            type="number" min={0} value={fields.defaultProbationMonths}
            onChange={(e) => set("defaultProbationMonths", Math.max(0, Number(e.target.value) || 0))}
          />
        </Field>
        <Field id={ids.maxContract} label={t("fieldMaxContractMonths")} error={errors.maxContractMonths}>
          <Input
            type="number" min={1} value={fields.maxContractMonths ?? ""}
            placeholder={t("contractUnlimited")}
            onChange={(e) => set("maxContractMonths", e.target.value ? Math.max(1, Number(e.target.value)) : null)}
          />
        </Field>
      </div>

      <fieldset style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12 }}>
        <legend style={{ fontSize: 13, fontWeight: 600, padding: "0 6px" }}>{t("statutoryLegend")}</legend>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
          <label style={checkboxRow}>
            <input type="checkbox" checked={fields.statutoryPf} onChange={(e) => set("statutoryPf", e.target.checked)} /> PF
          </label>
          <label style={checkboxRow}>
            <input type="checkbox" checked={fields.statutoryEsi} onChange={(e) => set("statutoryEsi", e.target.checked)} /> ESI
          </label>
          <label style={checkboxRow}>
            <input type="checkbox" checked={fields.statutoryNps} onChange={(e) => set("statutoryNps", e.target.checked)} /> NPS
          </label>
          <label style={checkboxRow}>
            <input type="checkbox" checked={fields.eligibleForGratuity} onChange={(e) => set("eligibleForGratuity", e.target.checked)} /> {t("fieldGratuity")}
          </label>
          <label style={checkboxRow}>
            <input type="checkbox" checked={fields.eligibleForBonus} onChange={(e) => set("eligibleForBonus", e.target.checked)} /> {t("fieldBonus")}
          </label>
          <label style={checkboxRow}>
            <input type="checkbox" checked={fields.leaveEncashment} onChange={(e) => set("leaveEncashment", e.target.checked)} /> {t("fieldLeaveEncashment")}
          </label>
        </div>
      </fieldset>

      <fieldset style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12 }}>
        <legend style={{ fontSize: 13, fontWeight: 600, padding: "0 6px" }}>{t("eligibilityLegend")}</legend>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
          <label style={checkboxRow}>
            <input type="checkbox" checked={fields.eligibleForLeave} onChange={(e) => set("eligibleForLeave", e.target.checked)} /> {t("colLeave")}
          </label>
          <label style={checkboxRow}>
            <input type="checkbox" checked={fields.eligibleForPayroll} onChange={(e) => set("eligibleForPayroll", e.target.checked)} /> {t("colPayroll")}
          </label>
          <label style={checkboxRow}>
            <input type="checkbox" checked={fields.eligibleForAppraisal} onChange={(e) => set("eligibleForAppraisal", e.target.checked)} /> {t("colAppraisal")}
          </label>
        </div>
      </fieldset>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <Button type="button" variant="secondary" onClick={() => router.push("/hr/employee-types")}>
          {t("cancelForm")}
        </Button>
        <Button type="submit" disabled={busy} style={{ minWidth: 140 }}>
          {busy ? t("saving") : mode === "create" ? t("createType") : t("saveChanges")}
        </Button>
      </div>
    </form>
  );
}
