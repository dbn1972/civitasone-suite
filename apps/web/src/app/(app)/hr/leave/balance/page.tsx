"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type EmployeeOption = { id: string; name: string; employeeNo: string };
type Allocation = {
  id: string;
  leaveTypeId: string;
  leaveTypeCode: string;
  leaveTypeName: string;
  fy: string;
  balanceDays: number;
};
type LeaveContext = {
  employee: { id: string; employeeNo: string; name: string };
  leaveTypes: { id: string; code: string; name: string; maxDays: number }[];
  allocations: Allocation[];
};

export default function LeaveBalancePage() {
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [empId, setEmpId] = useState("");
  const [ctx, setCtx] = useState<LeaveContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/proxy/v1/hrms/employees?limit=500")
      .then((r) => r.json())
      .then((body) => {
        const rows: EmployeeOption[] = Array.isArray(body) ? body : body.data ?? [];
        setEmployees(rows);
        if (rows[0]) setEmpId(rows[0].id);
      })
      .catch(() => setError("Failed to load employees."));
  }, []);

  useEffect(() => {
    if (!empId) return;
    setLoading(true);
    setError(null);
    fetch(`/api/proxy/v1/hrms/leave-context?employeeId=${encodeURIComponent(empId)}`)
      .then((r) => r.json())
      .then((data: LeaveContext) => setCtx(data))
      .catch(() => setError("Failed to load leave balance."))
      .finally(() => setLoading(false));
  }, [empId]);

  const usedByTypeId = (alloc: Allocation) => {
    const lt = ctx?.leaveTypes.find((t) => t.id === alloc.leaveTypeId);
    const total = lt?.maxDays ?? alloc.balanceDays;
    const used = total - alloc.balanceDays;
    return { total, used, balance: alloc.balanceDays };
  };

  const pct = (used: number, total: number) => (total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0);

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-3xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/hr" className="hover:text-slate-900">HR</Link>
          <span className="mx-2">/</span>
          <Link href="/hr/leave" className="hover:text-slate-900">Leave</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Balance</span>
        </nav>

        <header>
          <h1 className="text-3xl font-semibold text-slate-900">Leave Balance</h1>
          <p className="mt-1 text-sm text-slate-600">View leave entitlement and remaining balance for an employee.</p>
        </header>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <label htmlFor="emp-select" className="block text-sm font-medium text-slate-700 mb-1">Employee</label>
          <select
            id="emp-select"
            value={empId}
            onChange={(e) => setEmpId(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({e.employeeNo})
              </option>
            ))}
          </select>
        </div>

        {loading && (
          <p className="text-center text-sm text-slate-500 py-6">Loading balance…</p>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-600 font-medium">{error}</p>
        )}

        {!loading && ctx && (
          <div className="space-y-4">
            {ctx.allocations.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500 shadow-sm">
                <p className="text-2xl mb-2">🌴</p>
                <p className="font-medium text-slate-700">No leave allocated</p>
                <p className="text-sm mt-1">This employee has no leave allocation for FY {ctx.allocations[0]?.fy ?? "2026-27"}.</p>
                <Link href="/hr/leave/allocate" className="btn primary" style={{ marginTop: 12, display: "inline-block" }}>
                  Allocate Leave
                </Link>
              </div>
            ) : (
              ctx.allocations.map((alloc) => {
                const { total, used, balance } = usedByTypeId(alloc);
                const p = pct(used, total);
                return (
                  <div
                    key={alloc.id}
                    className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
                      <div>
                        <p className="font-semibold text-slate-900">{alloc.leaveTypeName}</p>
                        <p className="text-xs text-slate-500 mt-0.5">FY {alloc.fy} · Code: {alloc.leaveTypeCode}</p>
                      </div>
                      <p className="text-3xl font-bold tabular-nums" style={{ color: balance <= 0 ? "#dc2626" : "#166534" }}>
                        {balance}
                        <span className="text-base font-normal text-slate-500"> / {total} days</span>
                      </p>
                    </div>
                    <div style={{ marginTop: 14 }}>
                      <div style={{ height: 8, borderRadius: 4, background: "#e2e8f0", overflow: "hidden" }}>
                        <div
                          style={{
                            height: "100%",
                            width: `${p}%`,
                            borderRadius: 4,
                            background: p >= 90 ? "#dc2626" : p >= 60 ? "#f59e0b" : "#22c55e",
                            transition: "width 0.4s ease",
                          }}
                          aria-label={`${p}% used`}
                        />
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                        <span className="text-xs text-slate-500">{used} used</span>
                        <span className="text-xs text-slate-500">{balance} remaining</span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </section>
    </main>
  );
}
