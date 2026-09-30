"use client";
import { useEffect, useRef, useState, useId } from "react";
import { useRouter } from "next/navigation";
import { PageHeader, Card, Button, ConfirmDialog } from "../../../../_components/ds";
import { useFormError } from "@/lib/useFormError";
import { useTranslations } from "next-intl";

type EmployeeOption = { id: string; name: string; employeeNo: string };

export default function OvertimeNewPage() {
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
  // uses, plus a self-lock fallback for a caller with no list permission
  // (a bare "employee"), rather than inventing the generic component here.
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

  const today = new Date().toISOString().slice(0, 10);
  const isDirty = requestDate !== "" || hours !== "" || reason !== "" || (mode === "picker" && employeeId !== "");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/proxy/v1/hrms/employees?limit=500", { signal: controller.signal })
      .then(async (r) => {
        if (r.ok) {
          const body = await r.json();
          const rows: EmployeeOption[] = Array.isArray(body) ? body : (body.data ?? []);
          setEmployees(rows);
          setMode("picker");
          return;
        }
        if (r.status === 403) {
          const meRes = await fetch("/api/proxy/v1/hrms/me/profile", { signal: controller.signal });
          if (meRes.ok) {
            const me = await meRes.json();
            const profile = { id: me.id, name: me.fullName, employeeNo: me.employeeNo };
            setSelfProfile(profile);
            setEmployeeId(profile.id);
            setMode("self-locked");
            return;
          }
        }
        setMode("unavailable");
      })
      .catch((err) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setMode("unavailable");
      });
    return () => controller.abort();
  }, []);

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
    } catch {
      setMsg(formError.fromException("save").message);
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
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr/overtime" backLabel={t("backToOvertime")} />
      <div style={{ maxWidth: 520, marginTop: 20 }}>
      <Card title={t("cardTitle")}>
        <form onSubmit={handleSubmit} noValidate style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label htmlFor={empId} style={{ fontSize: 13, color: "var(--mut)", display: "block", marginBottom: 4 }}>{t("labelEmployee")}</label>
            {mode === "loading" && <p style={{ fontSize: 13, color: "var(--mut)" }}>{tMsg("loading")}</p>}
            {mode === "self-locked" && selfProfile && (
              <input id={empId} value={`${selfProfile.name} (${selfProfile.employeeNo})`} disabled readOnly />
            )}
            {mode === "picker" && (
              <select id={empId} value={employeeId}
                onChange={(e) => { setEmployeeId(e.target.value); clearErr("employeeId"); }}
                required aria-required="true"
                aria-invalid={invalid.has("employeeId") || !!employeeFieldError}
                aria-describedby={(invalid.has("employeeId") || employeeFieldError) ? `${empId}-error` : undefined}>
                <option value="">{t("selectEmployee")}</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>{emp.name} ({emp.employeeNo})</option>
                ))}
              </select>
            )}
            {mode === "unavailable" && <p role="alert" style={{ color: "var(--red, #c00)", fontSize: 12 }}>{t("employeeListUnavailable")}</p>}
            {(invalid.has("employeeId") || employeeFieldError) && (
              <p id={`${empId}-error`} role="alert" style={{ color: "var(--red, #c00)", fontSize: 12, margin: "4px 0 0" }}>
                {employeeFieldError || t("employeeRequired")}
              </p>
            )}
          </div>
          <div>
            <label htmlFor={dateId} style={{ fontSize: 13, color: "var(--mut)", display: "block", marginBottom: 4 }}>{t("labelDate")}</label>
            <input id={dateId} type="date" value={requestDate} max={today}
              onChange={(e) => { setRequestDate(e.target.value); clearErr("requestDate"); }}
              required aria-required="true"
              aria-invalid={!!dateFieldError}
              aria-describedby={dateFieldError ? `${dateId}-error` : undefined} />
            {dateFieldError && <p id={`${dateId}-error`} role="alert" style={{ color: "var(--red, #c00)", fontSize: 12, margin: "4px 0 0" }}>{dateFieldError}</p>}
          </div>
          <div>
            <label htmlFor={hrsId} style={{ fontSize: 13, color: "var(--mut)", display: "block", marginBottom: 4 }}>{t("labelHours")}</label>
            <input id={hrsId} type="number" step="0.5" min="0.5" max="24"
              value={hours} onChange={(e) => { setHours(e.target.value); clearErr("hours"); }}
              placeholder={t("placeholderHours")} required aria-required="true"
              aria-invalid={!!hoursFieldError}
              aria-describedby={hoursFieldError ? `${hrsId}-error` : undefined} />
            {hoursFieldError && <p id={`${hrsId}-error`} role="alert" style={{ color: "var(--red, #c00)", fontSize: 12, margin: "4px 0 0" }}>{hoursFieldError}</p>}
          </div>
          <div>
            <label htmlFor={reasonId} style={{ fontSize: 13, color: "var(--mut)", display: "block", marginBottom: 4 }}>{t("labelReason")}</label>
            <textarea id={reasonId} rows={3} style={{ resize: "vertical" }} maxLength={500}
              value={reason} onChange={(e) => { setReason(e.target.value); clearErr("reason"); }}
              placeholder={t("placeholderReason")}
              aria-invalid={!!reasonFieldError}
              aria-describedby={`${reasonId}-count${reasonFieldError ? ` ${reasonId}-error` : ""}`} />
            <p id={`${reasonId}-count`} style={{ fontSize: 11, color: "var(--mut)", margin: "3px 0 0" }}>{t("charCount", { count: reason.length })}</p>
            {reasonFieldError && <p id={`${reasonId}-error`} role="alert" style={{ color: "var(--red, #c00)", fontSize: 12, margin: "4px 0 0" }}>{reasonFieldError}</p>}
          </div>
          {msg && (
            <p role={status === "error" ? "alert" : "status"} aria-live={status === "error" ? "assertive" : "polite"} style={{ color: status === "error" ? "var(--red, #c00)" : "var(--green, #0a0)", fontSize: 13 }}>
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
