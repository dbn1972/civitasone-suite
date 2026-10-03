"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { Button, Modal, EntityPicker } from "../../../../_components/ds";
import { searchEmployees, resolveEmployees } from "@/lib/entityAdapters/employee";
import { istToday, validateRegularisationForm, friendlyRegularisationError, type RegularisationFormValues } from "./raise";

const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "10px 12px", fontSize: 14,
  border: "1px solid var(--line)", borderRadius: 10, background: "var(--bg2)", color: "var(--ink)", minHeight: 44,
};
const errStyle: React.CSSProperties = { color: "var(--bad, #b91c1c)", fontSize: 12, margin: "3px 0 0" };
const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 };

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
  const uid = useId();
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
            <div>
              <label htmlFor={`${uid}-emp`} style={labelStyle}>{t("raiseEmployee")} *</label>
              <EntityPicker id={`${uid}-emp`} value={employeeId} onChange={(v) => setEmployeeId(Array.isArray(v) ? (v[0] ?? null) : v)}
                search={searchEmployees} resolve={resolveEmployees} placeholder={t("raiseEmployeePlaceholder")} />
              {errors.employee ? <p role="alert" style={errStyle}>{t("raiseEmployeeRequired")}</p> : null}
            </div>
          ) : null}
          <div>
            <label htmlFor={`${uid}-date`} style={labelStyle}>{t("raiseDate")} *</label>
            <input id={`${uid}-date`} type="date" value={date} max={istToday()} onChange={(e) => setDate(e.target.value)} style={inputStyle} aria-invalid={!!errors.date} />
            {errors.date ? <p role="alert" style={errStyle}>{t("raiseDateInvalid")}</p> : null}
          </div>
          <div>
            <label htmlFor={`${uid}-status`} style={labelStyle}>{t("raiseStatus")} *</label>
            <select id={`${uid}-status`} value={requestedStatus} onChange={(e) => setRequestedStatus(e.target.value as RegularisationFormValues["requestedStatus"])} style={inputStyle}>
              <option value="present">{t("statusPresent")}</option>
              <option value="half_day">{t("statusHalfDay")}</option>
              <option value="absent">{t("statusAbsent")}</option>
            </select>
          </div>
          <div>
            <label htmlFor={`${uid}-reason`} style={labelStyle}>{t("raiseReason")} *</label>
            <textarea id={`${uid}-reason`} value={reason} rows={3} maxLength={500} onChange={(e) => setReason(e.target.value)} style={{ ...inputStyle, resize: "vertical" }} aria-invalid={!!errors.reason} />
            {errors.reason ? <p role="alert" style={errStyle}>{t("raiseReasonRequired")}</p> : null}
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>{t("raiseCancel")}</Button>
            <Button type="submit" disabled={busy}>{t("raiseSubmit")}</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
