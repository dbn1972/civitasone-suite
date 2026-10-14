"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { Button, Modal, EntityPicker, Field, Input, Select, Textarea } from "../../../../_components/ds";
import { searchEmployees, resolveEmployees } from "@/lib/entityAdapters/employee";
import { istToday, validateRegularisationForm, friendlyRegularisationError, type RegularisationFormValues } from "./raise";

/**
 * GAP-HR-ATTENDANCE-REGULARISATION-01: the missing "Raise request" flow.
 *
 * Who it is for follows the backend (attendance/routes.ts
 * resolveRegularisationSubject): an employee raises it for themselves (no
 * picker, the server derives the employee); a manager picks themselves or a
 * direct report; HR picks anyone. `canPickEmployee` is true for manager/HR.
 * The server stays the enforcement point -- the picker is only convenience.
 */
export function RaiseRegularisation({ canPickEmployee }: { canPickEmployee: boolean }) {
  const t = useTranslations("attendanceRegularisation");
  const router = useRouter();
  const formError = useFormError("regularisation request");
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [requestedStatus, setRequestedStatus] = useState<RegularisationFormValues["requestedStatus"]>("present");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState("");
  const [notice, setNotice] = useState("");
  const submitting = useRef(false);

  function reset() {
    setEmployeeId(null); setDate(""); setRequestedStatus("present"); setReason("");
    setErrors({}); setServerError("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting.current) return;
    const values: RegularisationFormValues = { employeeId, date, requestedStatus, reason };
    const errs = validateRegularisationForm(values, { needEmployee: canPickEmployee, today: istToday() });
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    submitting.current = true;
    setBusy(true);
    setServerError("");
    try {
      const res = await fetch("/api/proxy/v1/hrms/attendance/regularisations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(canPickEmployee && employeeId ? { employeeId } : {}),
          date, requestedStatus, reason: reason.trim(),
        }),
      });
      if (!res.ok) {
        const code = await res.clone().json().then((b: { code?: string }) => b.code ?? null).catch(() => null);
        const friendly = friendlyRegularisationError(code, {
          noRecord: t("errNoAttendanceRecord"), locked: t("errPeriodLocked"), notYourReport: t("errNotYourReport"),
        });
        setServerError(friendly ?? (await formError.fromResponse(res, "save")).message);
        return;
      }
      setOpen(false);
      reset();
      setNotice(t("raiseSuccess"));
      router.refresh();
    } catch (caught) {
      setServerError(formError.fromException("save", caught).message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <Button type="button" onClick={() => { setNotice(""); setOpen(true); }}>{t("raiseButton")}</Button>
      {notice ? <p role="status" className="pill good" style={{ margin: "8px 0 0" }}>{notice}</p> : null}
      <Modal open={open} onClose={() => { if (!busy) { setOpen(false); } }} title={t("raiseTitle")} size="md">
        <form onSubmit={submit} noValidate style={{ display: "grid", gap: 12 }}>
          {serverError ? <p role="alert" className="pill bad" style={{ margin: 0 }}>{serverError}</p> : null}
          {canPickEmployee ? (
            <Field label={t("raiseEmployee")} required error={errors.employee ? t("raiseEmployeeRequired") : formError.fieldError("employeeId")}>
              <EntityPicker value={employeeId} onChange={(v) => setEmployeeId(Array.isArray(v) ? (v[0] ?? null) : v)}
                search={searchEmployees} resolve={resolveEmployees} placeholder={t("raiseEmployeePlaceholder")} />
            </Field>
          ) : null}
          <Field label={t("raiseDate")} required error={errors.date ? t("raiseDateInvalid") : formError.fieldError("date")}>
            <Input type="date" value={date} max={istToday()} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={t("raiseStatus")} required error={formError.fieldError("requestedStatus")}>
            <Select value={requestedStatus} onChange={(e) => setRequestedStatus(e.target.value as RegularisationFormValues["requestedStatus"])}>
              <option value="present">{t("statusPresent")}</option>
              <option value="half_day">{t("statusHalfDay")}</option>
              <option value="absent">{t("statusAbsent")}</option>
            </Select>
          </Field>
          <Field label={t("raiseReason")} required error={errors.reason ? t("raiseReasonRequired") : formError.fieldError("reason")}>
            <Textarea value={reason} rows={3} maxLength={500} onChange={(e) => setReason(e.target.value)} style={{ resize: "vertical" }} />
          </Field>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>{t("raiseCancel")}</Button>
            <Button type="submit" disabled={busy}>{t("raiseSubmit")}</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
