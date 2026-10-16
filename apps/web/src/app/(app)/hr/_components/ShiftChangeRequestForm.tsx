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

import { UserFacingError } from "@/lib/userFacingError";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { useAsyncMutation } from "@/lib/useAsyncMutation";
import { Button, Field, Input, Select, Textarea } from "../../../_components/ds";
import { EmployeePicker } from "../../../_components/EmployeePicker";
import { translateFormErrors } from "./translateFormErrors";
import { validateShiftChange, type ShiftChangeErrors } from "./shiftChangeSchema";

type CreatedRequest = { id: string };
type ShiftRequestsList = { data: Array<{ id: string }> };

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
  const tv = useTranslations("hrFormErrors");
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

  const [clientErrors, setClientErrors] = useState<ShiftChangeErrors>({});
  /** Client validation first, then a backend rejection for the same field. */
  const errFor = (f: keyof ShiftChangeErrors) => clientErrors[f] ?? formError.fieldError(f);
  const clearClientError = (f: keyof ShiftChangeErrors) =>
    setClientErrors((e) => (e[f] ? { ...e, [f]: undefined } : e));

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

  // SF-15: the POST below is a 202-accepted async write -- see WFHRequestForm
  // for the full rationale. Same fix here: pending state, then poll
  // GET /shift-requests until the new request's id is visible, then
  // navigate (or fall back to "still processing").
  const asyncMutation = useAsyncMutation<CreatedRequest, ShiftRequestsList>({
    mutate: async () => {
      // The employee picker has no native `required`; refuse an empty pick here.
      if (!employeeId) throw new UserFacingError(t("errorEmployeeRequired"));
      let res: Response;
      try {
        res = await fetch("/api/proxy/v1/hrms/shift-requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ employeeId, currentShift, requestedShift, effectiveDate, reason: reason || undefined }),
        });
      } catch (caught) {
        throw UserFacingError.from(formError.fromException("save", caught));
      }
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        throw UserFacingError.from(resolved);
      }
      return (await res.json()) as CreatedRequest;
    },
    poll: async (created) => {
      const qs = employeeId ? `?empId=${encodeURIComponent(employeeId)}` : "";
      const res = await fetch(`/api/proxy/v1/hrms/shift-requests${qs}`);
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "load");
        throw UserFacingError.from(resolved);
      }
      return (await res.json()) as ShiftRequestsList;
    },
    isDone: (polled, created) => polled.data.some((row) => row.id === created.id),
    onConfirmed: () => router.push(redirectHref),
  });

  const submitDisabled = asyncMutation.isBusy;
  const displayPhase = state === "error" ? "error" : asyncMutation.phase;
  const displayErrorMsg = state === "error" ? errorMsg : asyncMutation.error;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = translateFormErrors(validateShiftChange({ employeeId, currentShift, requestedShift, effectiveDate, reason }), tv);
    const sameShift = !!currentShift && currentShift === requestedShift;
    if (sameShift) errs.requestedShift = t("errorSameShift");
    setClientErrors(errs);
    if (!currentShift || !requestedShift || !effectiveDate) {
      setErrorMsg(t("errorRequiredFields"));
      setState("error");
      return;
    }
    if (sameShift) {
      setErrorMsg(t("errorSameShift"));
      setState("error");
      return;
    }
    if (Object.keys(errs).length > 0) {
      setErrorMsg(!employeeId ? t("errorEmployeeRequired") : (Object.values(errs)[0] ?? ""));
      setState("error");
      return;
    }
    setState("idle");
    setErrorMsg("");
    formError.clear();
    await asyncMutation.run();
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
          background: "var(--info-bg)",
          border: "1px solid var(--info-border)",
          borderRadius: 6,
          padding: "10px 14px",
          fontSize: 13,
          color: "var(--info-text)",
        }}
      >
        {t("policyNote")}
      </div>

      {!prefillId && (
        <Field label={t("labelEmployee")} required error={errFor("employeeId")}>
          {employees.length > 0 ? (
            <Select
              value={employeeId}
              onChange={(e) => { setEmployeeId(e.target.value); clearClientError("employeeId"); }}
            >
              <option value="">{t("placeholderEmployee")}</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name ?? emp.id}{emp.employeeNo ? ` (${emp.employeeNo})` : ""}
                </option>
              ))}
            </Select>
          ) : (
            <EmployeePicker value={employeeId || null} onChange={(id) => { setEmployeeId(id ?? ""); clearClientError("employeeId"); }} />
          )}
        </Field>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Field label={t("labelCurrentShift")} required error={errFor("currentShift")}>
          {shifts.length > 0 ? (
            <Select value={currentShift} onChange={(e) => { setCurrentShift(e.target.value); clearClientError("currentShift"); }}>
              <option value="">{t("placeholderShift")}</option>
              {shifts.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
            </Select>
          ) : (
            <Input value={currentShift} onChange={(e) => { setCurrentShift(e.target.value); clearClientError("currentShift"); }} maxLength={120} />
          )}
        </Field>
        <Field label={t("labelRequestedShift")} required error={errFor("requestedShift")}>
          {shifts.length > 0 ? (
            <Select value={requestedShift} onChange={(e) => { setRequestedShift(e.target.value); clearClientError("requestedShift"); }}>
              <option value="">{t("placeholderShift")}</option>
              {shifts.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
            </Select>
          ) : (
            <Input value={requestedShift} onChange={(e) => { setRequestedShift(e.target.value); clearClientError("requestedShift"); }} maxLength={120} />
          )}
        </Field>
      </div>

      <Field label={t("labelEffectiveDate")} required error={errFor("effectiveDate")}>
        <Input
          type="date"
          value={effectiveDate}
          onChange={(e) => { setEffectiveDate(e.target.value); clearClientError("effectiveDate"); }}
          min={new Date().toISOString().split("T")[0]}
        />
      </Field>

      <Field label={t("labelReason")} error={errFor("reason")}>
        <Textarea
          style={{ resize: "vertical", minHeight: 80 }}
          value={reason}
          onChange={(e) => { setReason(e.target.value); clearClientError("reason"); }}
          placeholder={t("placeholderReason")}
          maxLength={500}
        />
      </Field>

      {displayPhase !== "idle" && displayPhase !== "submitting" && (
        <p
          role={displayPhase === "error" ? "alert" : "status"}
          style={{
            fontSize: 13,
            color: displayPhase === "error" ? "var(--red)" : "var(--green)",
            margin: 0,
          }}
        >
          {displayPhase === "error" && displayErrorMsg}
          {displayPhase === "pending" && t("confirming")}
          {displayPhase === "confirmed" && t("successMessage")}
          {displayPhase === "timed_out" && t("stillProcessing")}
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
          aria-busy={asyncMutation.isBusy}
          aria-disabled={submitDisabled}
        >
          {asyncMutation.isBusy ? t("submitting") : t("submitRequest")}
        </Button>
      </div>
    </form>
  );
}
