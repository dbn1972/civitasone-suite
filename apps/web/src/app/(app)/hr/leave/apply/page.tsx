"use client";

import Link from "next/link";
import { useState } from "react";

export default function ApplyLeavePage() {
  const [employeeId, setEmployeeId] = useState("");
  const [leaveType, setLeaveType] = useState("casual");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "accepted" | "error">("idle");
  const [message, setMessage] = useState("");

  function calcDays(): number {
    if (!fromDate || !toDate) return 0;
    const from = new Date(fromDate);
    const to = new Date(toDate);
    if (to < from) return 0;
    return Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!employeeId.trim() || !fromDate || !toDate) {
      setStatus("error");
      setMessage("Employee ID, From Date, and To Date are required.");
      return;
    }
    if (new Date(toDate) < new Date(fromDate)) {
      setStatus("error");
      setMessage("To Date must be on or after From Date.");
      return;
    }

    setStatus("submitting");
    setMessage("");

    const body = {
      employeeId: employeeId.trim(),
      leaveType,
      fromDate,
      toDate,
      days: calcDays(),
      reason: reason.trim() || undefined,
    };

    try {
      const res = await fetch("/api/proxy/v1/hrms/leave-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) {
        setStatus("error");
        setMessage(text || `Request failed (${res.status})`);
        return;
      }
      setStatus("accepted");
      setMessage("Leave request submitted for approval.");
      setEmployeeId("");
      setLeaveType("casual");
      setFromDate("");
      setToDate("");
      setReason("");
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
            <label className="block text-sm font-medium text-slate-700 mb-1">Employee ID</label>
            <input
              type="text"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              placeholder="e.g. EMP-001"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Leave Type</label>
            <select
              value={leaveType}
              onChange={(e) => setLeaveType(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="casual">Casual Leave</option>
              <option value="earned">Earned Leave</option>
              <option value="medical">Medical Leave</option>
              <option value="special">Special Leave</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">From Date</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">To Date</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          {days > 0 && (
            <p className="text-sm text-slate-600">
              Duration: <span className="font-semibold text-slate-900">{days} day{days !== 1 ? "s" : ""}</span>
            </p>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Reason (optional)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Briefly describe the reason for leave"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
            />
          </div>

          <button
            type="submit"
            disabled={status === "submitting"}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {status === "submitting" ? "Submitting…" : "Submit Leave Request"}
          </button>

          {message ? (
            <p className={`text-sm ${status === "error" ? "text-red-600" : "text-emerald-700"}`}>
              {message}
            </p>
          ) : null}
        </form>
      </section>
    </main>
  );
}
