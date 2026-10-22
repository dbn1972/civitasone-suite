"use client";
import { todayIST } from "@/lib/formatters";
import { useEffect, useRef, useState, useId } from "react";
import { useRouter } from "next/navigation";
import { PageHeader, Card, Button, ConfirmDialog, Field, Input, Select, Textarea } from "../../../../_components/ds";
import { useFormError } from "@/lib/useFormError";
import { useTranslations } from "next-intl";

type EmployeeOption = { id: string; name: string; employeeNo: string };

/**
 * The request form. `canFileForOthers` is true for HR staff (the only roles
 * the backend lets file on someone else's behalf); every other permitted
 * caller (a plain employee) can only file for themselves, so the field is
 * locked to their own record instead of offering a list. page.tsx (a Server
 * Component) decides which, from the session roles.
 */
export default function OvertimeNewForm({ canFileForOthers }: { canFileForOthers: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  const formError = useFormError("overtime request");
  const t = useTranslations("overtimeNew");
  const tMsg = useTranslations("msg");

  const empId    = useId();
  const dateId   = useId();
  const hrsId    = useId();
  const reasonId = useId();

  // GAP-HR-OVERTIME-NEW-01: a shared, cross-module EntityPicker (GAP-HR-SF-06)
  // is a larger, separate build (130 items across 28 modules per the
  // catalog's own shared-fix count) -- this is a page-local interim fix
  // using the same employees-list endpoint RequestAdvanceForm.tsx already
  // uses for HR staff, and a self-lock for everyone else.
  //
  // Rescan: the self-lock used to be reached only when the employees list
  // answered 403. That route now admits a plain employee (it returns their
  // direct reports, which for most employees is an empty list), so an
  // employee got an empty or reports-only picker and could not choose
  // themselves. The branch is now decided up front by role: only HR staff
  // (who can file for anyone) get the picker; everyone else's own record is
  // loaded from /me/profile and locked in.
  const [mode, setMode] = useState<"loading" | "picker" | "self-locked" | "unavailable">("loading");
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [selfProfile, setSelfProfile] = useState<EmployeeOption | null>(null);
  const [employeeId, setEmployeeId] = useState("");
  const [requestDate, setRequestDate] = useState("");
  const [hours, setHours] = useState("");
  const [reason, setReason] = useState("");
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const redirectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const today = todayIST();
  const isDirty = requestDate !== "" || hours !== "" || reason !== "" || (mode === "picker" && employeeId !== "");

  useEffect(() => {
    const controller = new AbortController();
    async function lockToSelf(): Promise<boolean> {
      const meRes = await fetch("/api/proxy/v1/hrms/me/profile", { signal: controller.signal });
      if (!meRes.ok) return false;
      const me = await meRes.json();
      if (!me || typeof me.id !== "string") return false;
      const profile = { id: me.id, name: me.fullName, employeeNo: me.employeeNo };
      setSelfProfile(profile);
      setEmployeeId(profile.id);
      setMode("self-locked");
      return true;
    }
    async function load() {
      if (!canFileForOthers) {
        if (!(await lockToSelf())) setMode("unavailable");
        return;
      }
      const r = await fetch("/api/proxy/v1/hrms/employees?limit=500", { signal: controller.signal });
      if (r.ok) {
        const body = await r.json();
        const rows: EmployeeOption[] = Array.isArray(body) ? body : (body.data ?? []);
        setEmployees(rows);
        setMode("picker");
        return;
      }
      // An HR caller whose directory read is refused can still file for themselves.
      if (r.status === 403 && (await lockToSelf())) return;
      setMode("unavailable");
    }
    load().catch((err) => {
      if (err instanceof Error && err.name === "AbortError") return;
      setMode("unavailable");
    });
    return () => controller.abort();
  }, [canFileForOthers]);

  useEffect(() => () => {
    if (redirectTimeout.current) clearTimeout(redirectTimeout.current);
  }, []);

  function clearErr(field: string) {
    setInvalid((s) => { const n = new Set(s); n.delete(field); return n; });
  }

  function validate(): boolean {
    const errs = new Set<string>();
    if (mode === "picker" && !employeeId) errs.add("employeeId");
    if (!requestDate) errs.add("requestDate");
    else if (requestDate > today) errs.add("requestDate");
    const h = Number(hours);
    if (!hours || isNaN(h) || h < 0.5 || h > 24) errs.add("hours");
    if (reason.length > 500) errs.add("reason");
    setInvalid(errs);
    return errs.size === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setStatus("submitting");
    try {
      const res = await fetch("/api/proxy/v1/hrms/overtime-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId, requestDate, hoursRequested: Number(hours),
          reason: reason || undefined,
        }),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setMsg(resolved.message);
        setStatus("error");
        return;
      }
      setStatus("done");
      setMsg(t("successMessage"));
      redirectTimeout.current = setTimeout(() => router.push("/hr/overtime"), 1000);
    } catch (caught) {
      setMsg(formError.fromException("save", caught).message);
      setStatus("error");
    }
  }

  function handleCancel() {
    if (isDirty) {
      setShowDiscardConfirm(true);
      return;
    }
    router.push("/hr/overtime");
  }

  const employeeFieldError = formError.fieldError("employeeId");
  const dateFieldError = invalid.has("requestDate") ? t("dateInvalid") : formError.fieldError("requestDate");
  const hoursFieldError = invalid.has("hours") ? t("hoursInvalid") : formError.fieldError("hoursRequested");
  const reasonFieldError = invalid.has("reason") ? t("reasonTooLong") : formError.fieldError("reason");

  return (
    <div className="page-main wrap">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr/overtime" backLabel={t("backToOvertime")} />
      <div style={{ maxWidth: 520, marginTop: 20 }}>
      <Card title={t("cardTitle")}>
        <form onSubmit={handleSubmit} noValidate style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
          <Field
            id={empId}
            label={t("labelEmployee")}
            required={mode === "picker"}
            error={(invalid.has("employeeId") || employeeFieldError) ? (employeeFieldError || t("employeeRequired")) : undefined}
          >
            {mode === "self-locked" && selfProfile ? (
              <Input value={`${selfProfile.name} (${selfProfile.employeeNo})`} disabled readOnly />
            ) : (
              <Select value={employeeId}
                onChange={(e) => { setEmployeeId(e.target.value); clearErr("employeeId"); }}
                disabled={mode !== "picker"}>
                <option value="">{t("selectEmployee")}</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>{emp.name} ({emp.employeeNo})</option>
                ))}
              </Select>
            )}
          </Field>
          {mode === "loading" && <p style={{ fontSize: 13, color: "var(--mut)", margin: 0 }}>{tMsg("loading")}</p>}
          {mode === "unavailable" && <p role="alert" style={{ color: "var(--red)", fontSize: 12, margin: 0 }}>{canFileForOthers ? t("employeeListUnavailable") : t("profileUnavailable")}</p>}
          <Field id={dateId} label={t("labelDate")} required error={dateFieldError}>
            <Input type="date" value={requestDate} max={today}
              onChange={(e) => { setRequestDate(e.target.value); clearErr("requestDate"); }} />
          </Field>
          <Field id={hrsId} label={t("labelHours")} required error={hoursFieldError}>
            <Input type="number" step="0.5" min="0.5" max="24"
              value={hours} onChange={(e) => { setHours(e.target.value); clearErr("hours"); }}
              placeholder={t("placeholderHours")} />
          </Field>
          <Field id={reasonId} label={t("labelReason")} error={reasonFieldError}>
            <Textarea rows={3} style={{ resize: "vertical" }} maxLength={500}
              value={reason} onChange={(e) => { setReason(e.target.value); clearErr("reason"); }}
              placeholder={t("placeholderReason")}
              aria-describedby={`${reasonId}-count${reasonFieldError ? ` ${reasonId}-error` : ""}`} />
            <p id={`${reasonId}-count`} style={{ fontSize: 11, color: "var(--mut)", margin: "3px 0 0" }}>{t("charCount", { count: reason.length })}</p>
          </Field>
          {/* GAP-HR-WORKFORCE-OVERTIME-NEW-02: the retired workforce/overtime/new
              form let the claimant name a specific duty-officer approver; the
              canonical POST /v1/hrms/overtime-requests schema has no such field
              (approval is a role check, not a named assignment -- see attendance/
              routes.ts's PATCH .../approve: any hr_admin/hr_officer/super_admin
              may decide it, never the submitter themself). Stating that plainly
              here, rather than a picker implying the submitter chooses who
              decides. */}
          <p style={{ fontSize: 12, color: "var(--mut)", margin: 0 }}>{t("approverInfo")}</p>
          {msg && (
            <p role={status === "error" ? "alert" : "status"} aria-live={status === "error" ? "assertive" : "polite"} style={{ color: status === "error" ? "var(--red)" : "var(--green)", fontSize: 13 }}>
              {msg}
            </p>
          )}
          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
            <Button variant="ghost" onClick={handleCancel}>{t("cancel")}</Button>
            <Button type="submit" variant="primary" disabled={status === "submitting" || mode === "loading" || mode === "unavailable"}>
              {status === "submitting" ? t("submitting") : t("submitRequest")}
            </Button>
          </div>
        </form>
      </Card>
      </div>

      <ConfirmDialog
        open={showDiscardConfirm}
        title={t("discardTitle")}
        description={t("discardMessage")}
        confirmLabel={t("discardConfirm")}
        danger
        onConfirm={() => { setShowDiscardConfirm(false); router.push("/hr/overtime"); }}
        onCancel={() => setShowDiscardConfirm(false)}
      />
    </div>
  );
}
