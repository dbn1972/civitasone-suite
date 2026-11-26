"use client";

/**
 * New deputation (depute OUT) -- GAP-HR-DEPUTATION-02.
 *
 * POST /v1/hrms/employees/:id/deputations (hr_admin / hr_officer / super_admin). The server immediately
 * switches the employee's effective posting and reporting line to the borrowing assignment, snapshots the
 * parent values for repatriation and writes a service-book entry -- so submitting goes through a confirm
 * dialog that names the employee and says so. Pay terms (parent/post scale etc.) are not asked here: they
 * are set afterwards through the deputation's pay-terms route and only influence pay once an approved pay
 * profile references the deputation.
 *
 * The borrowing organisation is free text with the standard central-government bodies (GOV_AGENCIES) offered
 * as suggestions -- a state department or PSU not in that list can still be typed.
 */
import { UserFacingError } from "@/lib/userFacingError";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Field, Input, Textarea, ConfirmDialog, useConfirmAction } from "@/app/_components/ds";
import { EmployeePicker } from "@/app/_components/EmployeePicker";
import { useFormError } from "@/lib/useFormError";
import { rupeesToMinorString } from "@/lib/money";
import { GOV_AGENCIES } from "../_components/DeputationCard";

type FieldKey = "employeeId" | "parentCadre" | "borrowingDepartment" | "tenureFrom" | "tenureTo" | "allowance";

function todayIsoIST(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Rupees typed by the user -> integer paise via the shared money helper (never a float on the wire). Blank = 0; null = not a valid non-negative amount. */
export function rupeesToPaise(raw: string): number | null {
  if (raw.trim() === "") return 0;
  const minor = rupeesToMinorString(raw, { allowZero: true });
  if (minor === null) return null;
  const n = Number(minor);
  return Number.isSafeInteger(n) ? n : null;
}

export function NewDeputationForm() {
  const t = useTranslations("deputationNew");
  const router = useRouter();
  const formError = useFormError("deputation");

  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [employeeName, setEmployeeName] = useState("");
  const [parentCadre, setParentCadre] = useState("");
  const [borrowingDepartment, setBorrowingDepartment] = useState("");
  const [tenureFrom, setTenureFrom] = useState(todayIsoIST());
  const [tenureTo, setTenureTo] = useState("");
  const [allowance, setAllowance] = useState("");
  const [orderRef, setOrderRef] = useState("");
  const [remarks, setRemarks] = useState("");
  const [lookupFailed, setLookupFailed] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});

  function validate(): boolean {
    const e: Partial<Record<FieldKey, string>> = {};
    if (!employeeId) e.employeeId = t("errEmployee");
    if (!parentCadre.trim()) e.parentCadre = t("errParentCadre");
    if (!borrowingDepartment.trim()) e.borrowingDepartment = t("errBorrowing");
    if (!tenureFrom) e.tenureFrom = t("errTenureFrom");
    if (!tenureTo) e.tenureTo = t("errTenureTo");
    else if (tenureFrom && tenureTo <= tenureFrom) e.tenureTo = t("errTenureOrder");
    if (rupeesToPaise(allowance) === null) e.allowance = t("errAllowance");
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  const {
    open, busy, error, trigger, cancel, confirm,
  } = useConfirmAction({
    onConfirm: async () => {
      const paise = rupeesToPaise(allowance);
      const res = await fetch(`/api/proxy/v1/hrms/employees/${employeeId}/deputations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          parentCadre: parentCadre.trim(),
          borrowingDepartment: borrowingDepartment.trim(),
          deputationAllowanceMinor: paise ?? 0,
          tenureFrom, tenureTo,
          orderRef: orderRef.trim() || undefined,
          remarks: remarks.trim() || undefined,
        }),
      });
      if (res.status === 409) throw new Error(t("errAlreadyDeputed"));
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        throw UserFacingError.from(resolved);
      }
    },
    onSuccess: () => { router.push("/hr/deputation"); router.refresh(); },
  });

  return (
    <form
      className="card"
      style={{ marginTop: 14 }}
      noValidate
      onSubmit={(ev) => { ev.preventDefault(); if (!lookupFailed && validate()) trigger(); }}
    >
      <div className="card-h"><h3>{t("heading")}</h3></div>
      <div className="pad" style={{ display: "grid", gap: 16 }}>
        <p style={{ fontSize: "0.8125rem", color: "var(--ink2)", margin: 0 }}>{t("intro")}</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
          <Field label={t("employeeLabel")} required error={errors.employeeId}>
            <EmployeePicker
              value={employeeId}
              onChange={(id, option) => { setEmployeeId(id); setEmployeeName(option?.label ?? ""); }}
              onFailedChange={setLookupFailed}
              placeholder={t("employeePlaceholder")}
              clearable
            />
          </Field>
          <Field label={t("parentCadreLabel")} required error={errors.parentCadre}>
            <Input value={parentCadre} maxLength={120} onChange={(e) => setParentCadre(e.target.value)} placeholder={t("parentCadrePlaceholder")} />
          </Field>
          <Field label={t("borrowingLabel")} required error={errors.borrowingDepartment} hint={t("borrowingHint")}>
            <Input list="deputation-borrowing-orgs" value={borrowingDepartment} maxLength={160} onChange={(e) => setBorrowingDepartment(e.target.value)} />
          </Field>
          <Field label={t("tenureFromLabel")} required error={errors.tenureFrom}>
            <Input type="date" value={tenureFrom} onChange={(e) => setTenureFrom(e.target.value)} />
          </Field>
          <Field label={t("tenureToLabel")} required error={errors.tenureTo}>
            <Input type="date" value={tenureTo} min={tenureFrom || undefined} onChange={(e) => setTenureTo(e.target.value)} />
          </Field>
          <Field label={t("allowanceLabel")} error={errors.allowance} hint={t("allowanceHint")}>
            <Input inputMode="decimal" value={allowance} onChange={(e) => setAllowance(e.target.value)} placeholder="0" />
          </Field>
          <Field label={t("orderRefLabel")}>
            <Input value={orderRef} maxLength={120} onChange={(e) => setOrderRef(e.target.value)} placeholder={t("orderRefPlaceholder")} />
          </Field>
        </div>
        <Field label={t("remarksLabel")}>
          <Textarea value={remarks} maxLength={2000} rows={3} onChange={(e) => setRemarks(e.target.value)} />
        </Field>
        <datalist id="deputation-borrowing-orgs">
          {GOV_AGENCIES.map((a) => <option key={a} value={a} />)}
        </datalist>
        <div style={{ display: "flex", gap: 10 }}>
          <Button type="submit" variant="primary" disabled={lookupFailed}>{t("submit")}</Button>
          <Button type="button" variant="ghost" onClick={() => router.push("/hr/deputation")}>{t("cancelBtn")}</Button>
        </div>
      </div>

      <ConfirmDialog
        open={open}
        title={t("confirmTitle", { name: employeeName || t("thisEmployee") })}
        description={t("confirmDescription", { name: employeeName || t("thisEmployee"), org: borrowingDepartment.trim(), from: tenureFrom, to: tenureTo })}
        confirmLabel={t("confirmLabel")}
        busy={busy}
        errorMessage={error}
        onConfirm={() => void confirm()}
        onCancel={cancel}
      />
    </form>
  );
}
