/**
 * ShiftChangeRequestForm — submits a shift-change request.
 * Maker-checker: employee submits -> supervisor approves.
 * GoI context: shift changes must be approved per DoPT staffing guidelines.
 * WCAG 2.2 AA: all form fields labelled, error states, 44px touch targets.
 *
 * CRITICAL fix: the entire shift-change feature was previously view-only --
 * no create route existed on disk, and no button anywhere linked to one --
 * despite POST /v1/hrms/shift-requests and the approve/reject routes already
 * working (WAVE-4). This is that missing create form, mirroring
 * WFHRequestForm's shape (prefill-vs-picker self-service pattern, same
 * useFormError/44px/aria conventions).
 */
"use client";

import { useEffect, useState, useId } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { Button } from "../../../_components/ds";

type EmployeeOption = { id: string; name?: string; employeeNo?: string };
type ShiftOption = { id: string; name: string };

interface ShiftChangeRequestFormProps {
  /** Pre-fill employee UUID (optional — admin filing on behalf, or the
   *  current user's own id for self-service). When set, the employee
   *  picker below is hidden entirely. */
  employeeId?: string;
  /** Where to send the user after a successful submit (and where Cancel goes). */
  redirectHref?: string;
}

type SubmitState = "idle" | "submitting" | "done" | "error";

export function ShiftChangeRequestForm({
  employeeId: prefillId = "",
  redirectHref = "/hr/shift-requests",
}: ShiftChangeRequestFormProps) {
  const router = useRouter();
  const t = useTranslations("shiftChangeForm");
  const [state, setState] = useState<SubmitState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const formError = useFormError("shift-change request");

  const [employeeId, setEmployeeId] = useState(prefillId);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [shifts, setShifts] = useState<ShiftOption[]>([]);
  const [currentShift, setCurrentShift] = useState("");
  const [requestedShift, setRequestedShift] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [reason, setReason] = useState("");

  const idEmp = useId();
  const idCurrent = useId();
  const idRequested = useId();
  const idDate = useId();
  const idReason = useId();

  // Same "picker over raw UUID" UX as WFHRequestForm.
  useEffect(() => {
    if (prefillId) return;
    let cancelled = false;
    fetch("/api/proxy/v1/hrms/employees?limit=500")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { data?: EmployeeOption[] } | EmployeeOption[]) => {
        if (cancelled) return;
        setEmployees(Array.isArray(body) ? body : (body.data ?? []));
      })
      .catch(() => { /* graceful fallback to raw-UUID input below */ });
    return () => { cancelled = true; };
  }, [prefillId]);

  // The shift catalogue (GET /v1/hrms/shifts) is best-effort: the backend
  // accepts any 1-120 char string for currentShift/requestedShift (there is
  // no enum), so a fetch failure degrades to plain text inputs rather than
  // blocking submission.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/proxy/v1/hrms/shifts")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { data?: ShiftOption[] } | ShiftOption[]) => {
        if (cancelled) return;
        const arr = Array.isArray(body) ? body : (body.data ?? []);
        setShifts(arr.filter((s) => s && s.name));
      })
      .catch(() => { /* graceful fallback to free-text inputs below */ });
    return () => { cancelled = true; };
  }, []);

  const submitDisabled = state === "submitting";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!currentShift || !requestedShift || !effectiveDate) {
      setErrorMsg(t("errorRequiredFields"));
      setState("error");
      return;
    }
    if (currentShift === requestedShift) {
      setErrorMsg(t("errorSameShift"));
      setState("error");
      return;
    }
    setState("submitting");
    setErrorMsg("");
    formError.clear();
    try {
      const res = await fetch("/api/proxy/v1/hrms/shift-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, currentShift, requestedShift, effectiveDate, reason: reason || undefined }),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setErrorMsg(resolved.message);
        setState("error");
        return;
      }
      setState("done");
      setTimeout(() => router.push(redirectHref), 900);
    } catch {
      setErrorMsg(formError.fromException("save").message);
      setState("error");
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label={t("ariaLabel")}
      style={{ display: "flex", flexDirection: "column", gap: 18, padding: "20px 24px" }}
    >
      <div
        role="note"
        style={{
          background: "var(--info-bg, #eff6ff)",
          border: "1px solid var(--info-border, #bfdbfe)",
          borderRadius: 6,
          padding: "10px 14px",
          fontSize: 13,
          color: "var(--info-text, #1d4ed8)",
        }}
      >
        {t("policyNote")}
      </div>

      {!prefillId && (
        <div>
          <label htmlFor={idEmp} style={labelStyle}>{t("labelEmployee")}</label>
          {employees.length > 0 ? (
            <select
              id={idEmp}
              style={inputStyle}
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              required
              aria-required="true"
            >
              <option value="">{t("placeholderEmployee")}</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name ?? emp.id}{emp.employeeNo ? ` (${emp.employeeNo})` : ""}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={idEmp}
              style={inputStyle}
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              pattern="[0-9a-fA-F-]{36}"
              required
              aria-required="true"
            />
          )}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div>
          <label htmlFor={idCurrent} style={labelStyle}>{t("labelCurrentShift")} <span aria-hidden>*</span></label>
          {shifts.length > 0 ? (
            <select id={idCurrent} style={inputStyle} value={currentShift} onChange={(e) => setCurrentShift(e.target.value)} required aria-required="true">
              <option value="">{t("placeholderShift")}</option>
              {shifts.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
          ) : (
            <input id={idCurrent} style={inputStyle} value={currentShift} onChange={(e) => setCurrentShift(e.target.value)} required aria-required="true" maxLength={120} />
          )}
        </div>
        <div>
          <label htmlFor={idRequested} style={labelStyle}>{t("labelRequestedShift")} <span aria-hidden>*</span></label>
          {shifts.length > 0 ? (
            <select id={idRequested} style={inputStyle} value={requestedShift} onChange={(e) => setRequestedShift(e.target.value)} required aria-required="true">
              <option value="">{t("placeholderShift")}</option>
              {shifts.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
          ) : (
            <input id={idRequested} style={inputStyle} value={requestedShift} onChange={(e) => setRequestedShift(e.target.value)} required aria-required="true" maxLength={120} />
          )}
          {formError.fieldError("requestedShift") && (
            <span role="alert" style={{ display: "block", fontSize: 12, color: "var(--red, #dc2626)", marginTop: 4 }}>
              {formError.fieldError("requestedShift")}
            </span>
          )}
        </div>
      </div>

      <div>
        <label htmlFor={idDate} style={labelStyle}>{t("labelEffectiveDate")} <span aria-hidden>*</span></label>
        <input
          id={idDate}
          type="date"
          style={inputStyle}
          value={effectiveDate}
          onChange={(e) => setEffectiveDate(e.target.value)}
          required
          aria-required="true"
          min={new Date().toISOString().split("T")[0]}
          aria-describedby={formError.fieldError("effectiveDate") ? "shift-date-err" : undefined}
        />
        {formError.fieldError("effectiveDate") && (
          <span id="shift-date-err" role="alert" style={{ display: "block", fontSize: 12, color: "var(--red, #dc2626)", marginTop: 4 }}>
            {formError.fieldError("effectiveDate")}
          </span>
        )}
      </div>

      <div>
        <label htmlFor={idReason} style={labelStyle}>{t("labelReason")}</label>
        <textarea
          id={idReason}
          style={{ ...inputStyle, resize: "vertical", minHeight: 80 }}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("placeholderReason")}
          maxLength={500}
        />
      </div>

      {(state === "error" || state === "done") && (
        <p
          role={state === "error" ? "alert" : "status"}
          style={{
            fontSize: 13,
            color: state === "error" ? "var(--red, #dc2626)" : "var(--green, #16a34a)",
            margin: 0,
          }}
        >
          {state === "done" ? t("successMessage") : errorMsg}
        </p>
      )}

      <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
        <Button
          type="button"
          variant="ghost"
          style={{ minHeight: 44 }}
          onClick={() => router.push(redirectHref)}
        >
          {t("cancel")}
        </Button>
        <Button
          type="submit"
          style={{ minHeight: 44 }}
          disabled={submitDisabled}
          aria-busy={state === "submitting"}
          aria-disabled={submitDisabled}
        >
          {state === "submitting" ? t("submitting") : t("submitRequest")}
        </Button>
      </div>
    </form>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 500,
  color: "var(--muted, #6b7280)",
  marginBottom: 5,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  minHeight: 44,
};
