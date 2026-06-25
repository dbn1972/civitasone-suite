"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useState } from "react";
import type { EmployeeSummary } from "@civitasone/types";
import { fetchOrQueue } from "@/lib/sync/requestQueue";

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
};

export function ApplyLeaveForm({ employees }: Props) {
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? "");
  const [leaveContext, setLeaveContext] = useState<LeaveContext | null>(null);
  const [allocId, setAllocId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "submitting" | "accepted" | "error">("idle");
  const [message, setMessage] = useState("");

  const employeeFieldId = useId();
  const leaveTypeFieldId = useId();
  const fromDateId = useId();
  const toDateId = useId();
  const reasonId = useId();
  const statusId = useId();

  const loadContext = useCallback(async (empId: string) => {
    if (!empId) {
      setLeaveContext(null);
      setAllocId("");
      return;
    }
    setStatus("loading");
    try {
      const res = await fetch(`/api/proxy/v1/hrms/leave-context?employeeId=${encodeURIComponent(empId)}`);
      if (!res.ok) throw new Error(await res.text());
      const ctx = (await res.json()) as LeaveContext;
      setLeaveContext(ctx);
      setAllocId(ctx.allocations[0]?.id ?? "");
      setStatus("idle");
    } catch (err) {
      setLeaveContext(null);
      setAllocId("");
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Failed to load leave balances");
    }
  }, []);

  useEffect(() => {
    void loadContext(employeeId);
  }, [employeeId, loadContext]);

  const selectedAlloc = leaveContext?.allocations.find((a) => a.id === allocId);

  function calcDays(): number {
    if (!fromDate || !toDate) return 0;
    const from = new Date(fromDate);
    const to = new Date(toDate);
    if (to < from) return 0;
    return Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!employeeId || !allocId || !selectedAlloc || !fromDate || !toDate) {
      setStatus("error");
      setMessage("Employee, leave type, from date, and to date are required.");
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
      setMessage(`Insufficient balance (${selectedAlloc.balanceDays} days available).`);
      return;
    }

    setStatus("submitting");
    setMessage("");

    const body = {
      employeeId,
      leaveTypeId: selectedAlloc.leaveTypeId,
      allocId,
      fromDate,
      toDate,
      daysApplied,
      reason: reason.trim() || undefined,
    };

    try {
      const { response, queued } = await fetchOrQueue("/v1/hrms/leave-requests", {
        method: "POST",
        body,
      });

      if (queued) {
        // Offline (or server unavailable): durably queued and will replay on reconnect.
        setStatus("accepted");
        setMessage("You're offline — leave request saved and will submit automatically when you reconnect.");
        setFromDate("");
        setToDate("");
        setReason("");
        return;
      }

      const text = response ? await response.text() : "";
      if (!response || !response.ok) {
        setStatus("error");
        setMessage(text || `Request failed (${response?.status ?? "network"})`);
        return;
      }
      setStatus("accepted");
      setMessage("Leave request submitted for approval.");
      setFromDate("");
      setToDate("");
      setReason("");
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
          <Link href="/hr" className="hover:text-slate-900">HR</Link>
          <span className="mx-2">/</span>
          <Link href="/hr/leave" className="hover:text-slate-900">Leave</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Apply</span>
        </nav>

        <header>
          <h1 className="text-3xl font-semibold text-slate-900">Apply for Leave</h1>
          <p className="mt-1 text-sm text-slate-600">Submit a leave request for approval.</p>
        </header>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <div>
            <label htmlFor={employeeFieldId} className="block text-sm font-medium text-slate-700 mb-1">Employee</label>
            <select
              id={employeeFieldId}
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
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

          <div>
            <label htmlFor={leaveTypeFieldId} className="block text-sm font-medium text-slate-700 mb-1">Leave Type</label>
            <select
              id={leaveTypeFieldId}
              value={allocId}
              onChange={(e) => setAllocId(e.target.value)}
              disabled={!leaveContext?.allocations.length}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
            >
              {!leaveContext?.allocations.length ? (
                <option value="">No leave allocations</option>
              ) : (
                leaveContext.allocations.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.leaveTypeName} ({a.balanceDays} days balance)
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor={fromDateId} className="block text-sm font-medium text-slate-700 mb-1">From Date</label>
              <input
                id={fromDateId}
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label htmlFor={toDateId} className="block text-sm font-medium text-slate-700 mb-1">To Date</label>
              <input
                id={toDateId}
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          {days > 0 ? (
            <p className="text-sm text-slate-600">
              Duration: <span className="font-semibold text-slate-900">{days} day{days !== 1 ? "s" : ""}</span>
            </p>
          ) : null}

          <div>
            <label htmlFor={reasonId} className="block text-sm font-medium text-slate-700 mb-1">Reason (optional)</label>
            <textarea
              id={reasonId}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Briefly describe the reason for leave"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
            />
          </div>

          <button
            type="submit"
            disabled={status === "submitting" || status === "loading" || employees.length === 0 || !allocId}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {status === "submitting" ? "Submitting…" : "Submit Leave Request"}
          </button>

          {message ? (
            <p
              id={statusId}
              role={status === "error" ? "alert" : "status"}
              aria-live={status === "error" ? "assertive" : "polite"}
              className={`text-sm ${status === "error" ? "text-red-600" : "text-emerald-700"}`}
            >
              <span className="font-semibold">{status === "error" ? "Error: " : "Success: "}</span>
              {message}
            </p>
          ) : null}
        </form>
      </section>
    </main>
  );
}
