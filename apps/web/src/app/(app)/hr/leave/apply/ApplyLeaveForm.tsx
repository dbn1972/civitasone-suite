"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EmployeeSummary } from "@civitasone/types";
import { fetchOrQueue } from "@/lib/sync/requestQueue";
import { trackActivation } from "@/lib/activation";
import { useToast } from "@/app/_components/ds/Toast";
import {
  useFieldValidation,
  required,
  minLength,
  type Validator,
} from "@/lib/form-validation";

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
};

// Shared field input class
const fieldCls =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500";
const errorCls = "mt-1 text-xs text-red-600";

export function ApplyLeaveForm({ employees, initialEmployeeId }: Props) {
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

  // Ref that mirrors fromDate value for the cross-field toDate validator.
  // Updated during render (write-to-ref-during-render pattern — safe in React).
  const fromDateRef = useRef("");

  // Cross-field toDate validator — reads fromDateRef synchronously at call time.
  const toDateAfterFrom: Validator = useCallback(
    (v) => {
      if (!v || !fromDateRef.current) return undefined;
      return new Date(v) < new Date(fromDateRef.current)
        ? "To date must be on or after from date."
        : undefined;
    },
    [],
  );

  const { fields, validate, values, reset: resetFields } = useFieldValidation({
    allocId: [required()],
    fromDate: [required()],
    toDate: [required(), toDateAfterFrom],
    reason: [required(), minLength(20)],
  });

  // Keep fromDateRef current so the toDate validator sees the latest value.
  fromDateRef.current = values.fromDate;

  const loadContext = useCallback(async (empId: string) => {
    if (!empId) {
      setLeaveContext(null);
      return;
    }
    setStatus("loading");
    try {
      const res = await fetch(
        `/api/proxy/v1/hrms/leave-context?employeeId=${encodeURIComponent(empId)}`,
      );
      if (!res.ok) throw new Error(await res.text());
      const ctx = (await res.json()) as LeaveContext;
      setLeaveContext(ctx);
      setStatus("idle");
    } catch (err) {
      setLeaveContext(null);
      setStatus("error");
      setMessage(
        err instanceof Error ? err.message : "Failed to load leave balances",
      );
    }
  }, []);

  useEffect(() => {
    void loadContext(employeeId);
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
      setMessage("Please fix the errors above before submitting.");
      return;
    }

    if (!selectedAlloc) {
      setStatus("error");
      setMessage("Please select a valid leave type.");
      return;
    }

    const daysApplied = calcDays();
    if (daysApplied <= 0) {
      setStatus("error");
      setMessage("To date must be on or after from date.");
      return;
    }
    if (daysApplied > selectedAlloc.balanceDays) {
      setStatus("error");
      setMessage(
        `Insufficient balance (${selectedAlloc.balanceDays} days available).`,
      );
      return;
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
        setMessage(
          "You're offline — leave request saved and will submit automatically when you reconnect.",
        );
        toast.info(
          "Leave request queued — will submit when you're back online.",
        );
        resetFields();
        return;
      }

      const text = response ? await response.text() : "";
      if (!response || !response.ok) {
        setStatus("error");
        setMessage(
          text || `Request failed (${response?.status ?? "network"})`,
        );
        toast.error(
          "Leave request failed. Please check the details and try again.",
        );
        return;
      }
      setStatus("accepted");
      trackActivation("first_transaction");
      setMessage("Leave request submitted for approval.");
      toast.success("Leave request submitted for approval.");
      resetFields();
      void loadContext(employeeId);
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Network error");
    }
  }

  const days = calcDays();

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-2xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/hr" className="hover:text-slate-900">
            HR
          </Link>
          <span className="mx-2">/</span>
          <Link href="/hr/leave" className="hover:text-slate-900">
            Leave
          </Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Apply</span>
        </nav>

        <header>
          <h1 className="text-3xl font-semibold text-slate-900">
            Apply for Leave
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Submit a leave request for approval.
          </p>
        </header>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
          noValidate
        >
          {/* Employee selector (not validated — always has a default) */}
          <div>
            <label
              htmlFor="leave-employee"
              className="block text-sm font-medium text-slate-700 mb-1"
            >
              Employee
            </label>
            <select
              id="leave-employee"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className={fieldCls}
            >
              {employees.length === 0 ? (
                <option value="">No employees loaded</option>
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
              Leave Type{" "}
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
            >
              {!leaveContext?.allocations.length ? (
                <option value="">No leave allocations</option>
              ) : (
                <>
                  <option value="">Select a leave type…</option>
                  {leaveContext.allocations.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.leaveTypeName} ({a.balanceDays} days balance)
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
                From Date{" "}
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
                To Date{" "}
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
              />
              {fields.toDate.error && (
                <p id="leave-to-error" className={errorCls} role="alert">
                  {fields.toDate.error}
                </p>
              )}
            </div>
          </div>

          {days > 0 ? (
            <p className="text-sm text-slate-600">
              Duration:{" "}
              <span className="font-semibold text-slate-900">
                {days} day{days !== 1 ? "s" : ""}
              </span>
            </p>
          ) : null}

          {/* Reason — required, min 20 chars */}
          <div>
            <label
              htmlFor="leave-reason"
              className="block text-sm font-medium text-slate-700 mb-1"
            >
              Reason{" "}
              <span aria-hidden="true" className="text-red-500">
                *
              </span>
              <span className="ml-1 font-normal text-slate-500">
                (min. 20 characters)
              </span>
            </label>
            <textarea
              id="leave-reason"
              value={fields.reason.value}
              onChange={fields.reason.onChange}
              onBlur={fields.reason.onBlur}
              rows={3}
              placeholder="Briefly describe the reason for leave"
              aria-invalid={!!fields.reason.error}
              aria-describedby={
                fields.reason.error ? "leave-reason-error" : undefined
              }
              className={`${fieldCls} resize-none`}
            />
            {fields.reason.error && (
              <p id="leave-reason-error" className={errorCls} role="alert">
                {fields.reason.error}
              </p>
            )}
            {!fields.reason.error && fields.reason.value.length > 0 && (
              <p className="mt-1 text-xs text-slate-400">
                {fields.reason.value.trim().length} / 20+ chars
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
            {status === "submitting" ? "Submitting…" : "Submit Leave Request"}
          </button>

          {message ? (
            <p
              role={status === "error" ? "alert" : "status"}
              aria-live={status === "error" ? "assertive" : "polite"}
              className={`text-sm ${status === "error" ? "text-red-600" : "text-emerald-700"}`}
            >
              <span className="font-semibold">
                {status === "error" ? "Error: " : ""}
              </span>
              {message}
            </p>
          ) : null}
        </form>
      </section>
    </main>
  );
}
