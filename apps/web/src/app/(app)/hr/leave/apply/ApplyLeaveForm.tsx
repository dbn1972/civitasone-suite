"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EmployeeSummary } from "@civitasone/types";
import { fetchOrQueue } from "@/lib/sync/requestQueue";
import { trackActivation } from "@/lib/activation";
import { useToast } from "@/app/_components/ds/Toast";
import { useTranslations } from "next-intl";
import {
  useFieldValidation,
  required,
  minLength,
  type Validator,
} from "@/lib/form-validation";
import { useFormError } from "@/lib/useFormError";

type LeaveAllocation = {
  id: string;
  leaveTypeId: string;
  leaveTypeCode: string;
  leaveTypeName: string;
  balanceDays: number;
};

type LeaveContext = {
  employee: { id: string; employeeNo: string; name: string };
  leaveTypes: Array<{ id: string; code: string; name: string; maxDays: number }>;
  allocations: LeaveAllocation[];
};

type Props = {
  employees: EmployeeSummary[];
  /** Preselects this employee when arriving via a deep link (e.g. an employee
   *  profile's "Apply Leave" quick action, ?empId=...). Falls back to the
   *  first employee in the list if not provided or not found in it. */
  initialEmployeeId?: string;
  /** True when the logged-in user has no linked employee record at all — a
   *  normal 404 from the self-service profile endpoint, not a fetch failure
   *  — and (being a plain `employee`) no admin-picker access either. There
   *  is nothing this form can do for them yet, so it shows a clear, honest
   *  message instead of a confusing empty "no employees loaded" dropdown. */
  noLinkedProfile?: boolean;
};

// Shared field input class
const fieldCls =
  "w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500";
const fieldStyle: React.CSSProperties = { background: "var(--panel, #fff)", borderColor: "var(--line, #cbd5e1)", color: "var(--ink)" };
const errorCls = "mt-1 text-xs text-red-600";

export function ApplyLeaveForm({ employees, initialEmployeeId, noLinkedProfile }: Props) {
  const t = useTranslations("leaveApply");
  const preselected = initialEmployeeId && employees.some((e) => e.id === initialEmployeeId)
    ? initialEmployeeId
    : employees[0]?.id ?? "";
  const [employeeId, setEmployeeId] = useState(preselected);
  const [leaveContext, setLeaveContext] = useState<LeaveContext | null>(null);
  const [status, setStatus] = useState<
    "idle" | "loading" | "submitting" | "accepted" | "error"
  >("idle");
  const [message, setMessage] = useState("");
  const { toast } = useToast();
  const formError = useFormError("leave request");

  // Ref that mirrors fromDate value for the cross-field toDate validator.
  // Updated during render (write-to-ref-during-render pattern — safe in React).
  const fromDateRef = useRef("");

  // Cross-field toDate validator — reads fromDateRef synchronously at call time.
  const toDateAfterFrom: Validator = useCallback(
    (v) => {
      if (!v || !fromDateRef.current) return undefined;
      return new Date(v) < new Date(fromDateRef.current)
        ? t("toDateAfterFromError")
        : undefined;
    },
    [t],
  );

  const { fields, validate, values, reset: resetFields } = useFieldValidation({
    allocId: [required()],
    fromDate: [required()],
    toDate: [required(), toDateAfterFrom],
    reason: [required(), minLength(20)],
  });

  // Keep fromDateRef current so the toDate validator sees the latest value.
  fromDateRef.current = values.fromDate;

  const loadContext = useCallback(async (empId: string, signal?: AbortSignal) => {
    if (!empId) {
      setLeaveContext(null);
      return;
    }
    setStatus("loading");
    try {
      const res = await fetch(
        `/api/proxy/v1/hrms/leave-context?employeeId=${encodeURIComponent(empId)}`,
        { signal },
      );
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "load");
        throw new Error(resolved.message);
      }
      const ctx = (await res.json()) as LeaveContext;
      setLeaveContext(ctx);
      setStatus("idle");
    } catch (err) {
      // An abort means either this component unmounted, or (just as real a
      // risk here, since this effect re-fires on every employeeId change) a
      // newer load for a *different* employeeId has already superseded this
      // one -- either way, painting this stale attempt's error state would
      // be wrong, possibly showing "failed to load" over a context that
      // actually loaded fine a moment later, or vice versa.
      if (err instanceof Error && err.name === "AbortError") return;
      setLeaveContext(null);
      setStatus("error");
      setMessage(
        err instanceof Error ? err.message : formError.fromException("load").message,
      );
    }
    // formError.fromResponse/fromException are stable across renders (see
    // useFormError) even though the wrapping object literal isn't.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- formError.fromResponse/fromException/clear are stable (useCallback'd on a fixed area string in useFormError); the wrapping object is recreated every render but isn't read here.
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadContext(employeeId, controller.signal);
    return () => controller.abort();
  }, [employeeId, loadContext]);

  // When employee changes, reset validation state too.
  useEffect(() => {
    resetFields();
  }, [employeeId, resetFields]);

  const selectedAlloc = leaveContext?.allocations.find(
    (a) => a.id === values.allocId,
  );

  function calcDays(): number {
    if (!values.fromDate || !values.toDate) return 0;
    const from = new Date(values.fromDate);
    const to = new Date(values.toDate);
    if (to < from) return 0;
    return Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Run all validators; if any fail, abort.
    if (!validate()) {
      setStatus("error");
      setMessage(t("fixErrorsError"));
      return;
    }

    if (!selectedAlloc) {
      setStatus("error");
      setMessage(t("selectValidLeaveTypeError"));
      return;
    }

    const daysApplied = calcDays();
    if (daysApplied <= 0) {
      setStatus("error");
      setMessage(t("toDateAfterFromError"));
      return;
    }
    // NOTE: Client counts calendar days but the backend computes working days
    // (excluding weekends/holidays). A strict client-side balance check would
    // reject valid requests. Show a warning instead and let the backend decide.
    if (daysApplied > selectedAlloc.balanceDays) {
      const proceed = confirm(
        t("balanceWarning", { days: daysApplied, balance: selectedAlloc.balanceDays })
      );
      if (!proceed) return;
    }

    setStatus("submitting");
    setMessage("");

    const body = {
      employeeId,
      leaveTypeId: selectedAlloc.leaveTypeId,
      allocId: values.allocId,
      fromDate: values.fromDate,
      toDate: values.toDate,
      daysApplied,
      reason: values.reason.trim(),
    };

    try {
      const { response, queued } = await fetchOrQueue(
        "/v1/hrms/leave-requests",
        { method: "POST", body },
      );

      if (queued) {
        setStatus("accepted");
        setMessage(t("queuedMessage"));
        toast.info(t("queuedToast"));
        resetFields();
        return;
      }

      if (!response || !response.ok) {
        const resolved = response
          ? await formError.fromResponse(response, "save")
          : formError.fromException("save");
        setStatus("error");
        setMessage(resolved.message);
        toast.error(resolved.message);
        return;
      }
      setStatus("accepted");
      trackActivation("first_transaction");
      setMessage(t("acceptedMessage"));
      toast.success(t("acceptedMessage"));
      resetFields();
      void loadContext(employeeId);
    } catch {
      setStatus("error");
      setMessage(formError.fromException("save").message);
    }
  }

  const days = calcDays();

  // No employee record is linked to this account at all (a normal 404, not
  // a fetch failure — see page.tsx), and a plain `employee` role has no
  // admin-picker fallback either. There is nothing to fill in here: show a
  // clear, honest message instead of a form full of fields that can never be
  // submitted (the picker would otherwise render an unexplained, permanently
  // empty "No employees loaded" dropdown with a disabled submit button).
  if (noLinkedProfile) {
    return (
      <section className="mx-auto max-w-2xl space-y-5">
        <div
          role="alert"
          className="rounded-xl border p-6 text-sm"
          style={{ background: "var(--warnbg, #fffbeb)", borderColor: "var(--warnbd, #fde68a)", color: "var(--warn, #92400e)" }}
        >
          {t("noLinkedProfileMessage")}
        </div>
      </section>
    );
  }

  // The page shell (landmark <main>, page <h1>, subtitle, and "back to Leave"
  // link) is already rendered once by page.tsx via the shared <PageHeader>
  // design-system component. This component used to duplicate all of that —
  // its own <main>, its own breadcrumb nav, and its own "Apply for Leave" <h1>
  // — producing two <main> landmarks and two identical page headings on the
  // same page (caught by e2e/hr.spec.ts: getByRole('heading', { name: /leave/i })
  // resolved to 2 elements). Keep only the form itself here.
  return (
    <section className="mx-auto max-w-2xl space-y-5">
      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-xl border p-6 shadow-sm"
        style={{ background: "var(--panel, #fff)", borderColor: "var(--line, #e2e8f0)" }}
        noValidate
      >
        {/* Employee selector (not validated — always has a default) */}
        <div>
          <label
            htmlFor="leave-employee"
            className="block text-sm font-medium text-slate-700 mb-1"
          >
            {t("employeeLabel")}
          </label>
          <select
            id="leave-employee"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className={fieldCls}
            style={fieldStyle}
          >
            {employees.length === 0 ? (
              <option value="">{t("noEmployeesLoaded")}</option>
            ) : (
              employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name} ({emp.department})
                </option>
              ))
            )}
          </select>
        </div>

        {/* Leave Type — validated: required */}
        <div>
          <label
            htmlFor="leave-type"
            className="block text-sm font-medium text-slate-700 mb-1"
          >
            {t("leaveTypeLabel")}{" "}
            <span aria-hidden="true" className="text-red-500">
              *
            </span>
          </label>
          <select
            id="leave-type"
            value={fields.allocId.value}
            onChange={fields.allocId.onChange}
            onBlur={fields.allocId.onBlur}
            disabled={!leaveContext?.allocations.length}
            aria-invalid={!!fields.allocId.error}
            aria-describedby={
              fields.allocId.error ? "leave-type-error" : undefined
            }
            className={`${fieldCls} disabled:opacity-60`}
            style={fieldStyle}
          >
            {!leaveContext?.allocations.length ? (
              <option value="">{t("noLeaveAllocations")}</option>
            ) : (
              <>
                <option value="">{t("selectLeaveTypePlaceholder")}</option>
                {leaveContext.allocations.map((a) => (
                  <option key={a.id} value={a.id}>
                    {t("allocationOption", { name: a.leaveTypeName, balance: a.balanceDays })}
                  </option>
                ))}
              </>
            )}
          </select>
          {fields.allocId.error && (
            <p id="leave-type-error" className={errorCls} role="alert">
              {fields.allocId.error}
            </p>
          )}
        </div>

        {/* Date range — both required; toDate must be >= fromDate */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="leave-from"
              className="block text-sm font-medium text-slate-700 mb-1"
            >
              {t("fromDateLabel")}{" "}
              <span aria-hidden="true" className="text-red-500">
                *
              </span>
            </label>
            <input
              id="leave-from"
              type="date"
              value={fields.fromDate.value}
              onChange={fields.fromDate.onChange}
              onBlur={fields.fromDate.onBlur}
              aria-invalid={!!fields.fromDate.error}
              aria-describedby={
                fields.fromDate.error ? "leave-from-error" : undefined
              }
              className={fieldCls}
              style={fieldStyle}
            />
            {fields.fromDate.error && (
              <p id="leave-from-error" className={errorCls} role="alert">
                {fields.fromDate.error}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="leave-to"
              className="block text-sm font-medium text-slate-700 mb-1"
            >
              {t("toDateLabel")}{" "}
              <span aria-hidden="true" className="text-red-500">
                *
              </span>
            </label>
            <input
              id="leave-to"
              type="date"
              value={fields.toDate.value}
              onChange={fields.toDate.onChange}
              onBlur={fields.toDate.onBlur}
              aria-invalid={!!fields.toDate.error}
              aria-describedby={
                fields.toDate.error ? "leave-to-error" : undefined
              }
              className={fieldCls}
              style={fieldStyle}
            />
            {fields.toDate.error && (
              <p id="leave-to-error" className={errorCls} role="alert">
                {fields.toDate.error}
              </p>
            )}
          </div>
        </div>

        {days > 0 ? (
          <div className="text-sm text-slate-600">
            <p style={{ margin: 0 }}>
              {t("durationLabel")}{" "}
              <span className="font-semibold text-slate-900">
                {t("daysCount", { count: days })}
              </span>
            </p>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--mut, #94a3b8)" }}>
              {t("calendarDaysDisclaimer")}
            </p>
          </div>
        ) : null}

        {/* Reason — required, min 20 chars */}
        <div>
          <label
            htmlFor="leave-reason"
            className="block text-sm font-medium text-slate-700 mb-1"
          >
            {t("reasonLabel")}{" "}
            <span aria-hidden="true" className="text-red-500">
              *
            </span>
            <span className="ms-1 font-normal text-slate-500">
              {t("reasonHint")}
            </span>
          </label>
          <textarea
            id="leave-reason"
            value={fields.reason.value}
            onChange={fields.reason.onChange}
            onBlur={fields.reason.onBlur}
            rows={3}
            placeholder={t("reasonPlaceholder")}
            aria-invalid={!!fields.reason.error}
            aria-describedby={
              fields.reason.error ? "leave-reason-error" : undefined
            }
            className={`${fieldCls} resize-none`}
            style={fieldStyle}
          />
          {fields.reason.error && (
            <p id="leave-reason-error" className={errorCls} role="alert">
              {fields.reason.error}
            </p>
          )}
          {!fields.reason.error && fields.reason.value.length > 0 && (
            <p className="mt-1 text-xs text-slate-400">
              {t("charsCount", { count: fields.reason.value.trim().length })}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={
            status === "submitting" ||
            status === "loading" ||
            employees.length === 0
          }
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {status === "submitting" ? t("submitSubmitting") : t("submitLabel")}
        </button>

        {message ? (
          <p
            role={status === "error" ? "alert" : "status"}
            aria-live={status === "error" ? "assertive" : "polite"}
            className={`text-sm ${status === "error" ? "text-red-600" : "text-emerald-700"}`}
          >
            <span className="font-semibold">
              {status === "error" ? t("errorPrefix") : ""}
            </span>
            {message}
          </p>
        ) : null}
      </form>
    </section>
  );
}
