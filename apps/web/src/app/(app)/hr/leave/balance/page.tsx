"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader, StatGrid, StatCard, Card } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PrintButton } from "../../../../_components/PrintButton";

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
  const [empId, setEmpId]         = useState("");
  const [ctx, setCtx]             = useState<LeaveContext | null>(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [source, setSource]       = useState<"api" | "error">("api");

  useEffect(() => {
    fetch("/api/proxy/v1/hrms/employees?limit=500")
      .then((r) => r.json())
      .then((body) => {
        const rows: EmployeeOption[] = Array.isArray(body) ? body : (body.data ?? []);
        setEmployees(rows);
        if (rows[0]) setEmpId(rows[0].id);
      })
      .catch(() => { setError("Failed to load employees."); setSource("error"); });
  }, []);

  useEffect(() => {
    if (!empId) return;
    setLoading(true);
    setError(null);
    fetch(`/api/proxy/v1/hrms/leave-context?employeeId=${encodeURIComponent(empId)}`)
      .then((r) => r.json())
      .then((data: LeaveContext) => setCtx(data))
      .catch(() => { setError("Failed to load leave balance."); setSource("error"); })
      .finally(() => setLoading(false));
  }, [empId]);

  const usedByTypeId = (alloc: Allocation) => {
    const lt = ctx?.leaveTypes.find((t) => t.id === alloc.leaveTypeId);
    const total = lt?.maxDays ?? alloc.balanceDays;
    const used  = total - alloc.balanceDays;
    return { total, used, balance: alloc.balanceDays };
  };

  const pct = (used: number, total: number) =>
    total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;

  const totalTypes       = ctx?.allocations.length ?? 0;
  const totalEntitlement = ctx?.allocations.reduce((s, a) => {
    const lt = ctx?.leaveTypes.find((t) => t.id === a.leaveTypeId);
    return s + (lt?.maxDays ?? a.balanceDays);
  }, 0) ?? 0;
  const totalBalance  = ctx?.allocations.reduce((s, a) => s + a.balanceDays, 0) ?? 0;
  const totalUsed     = totalEntitlement - totalBalance;

  return (
    <main className="page-main wrap leave-balance-print" aria-labelledby="page-heading">
      <PageHeader
        title="Leave Balance"
        subtitle="View leave entitlement and remaining balance for an employee."
        back="/hr/leave"
      />
      <DataSourceBadge source={source} />
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }} className="no-print">
        <PrintButton label="Download Leave Balance" />
      </div>

      {ctx && (
        <StatGrid>
          <StatCard icon="\U0001f334" iconBg="var(--goodbg)" label="Leave Types"     value={totalTypes} />
          <StatCard icon="\U0001f4c5" iconBg="var(--infobg)" label="Total Entitlement" value={`${totalEntitlement}d`} />
          <StatCard icon="\u2705"       iconBg="var(--warnbg)" label="Total Used"      value={`${totalUsed}d`} />
          <StatCard icon="\u23f3"       iconBg="var(--panel)" label="Total Remaining" value={`${totalBalance}d`} />
        </StatGrid>
      )}

      <Card title="Select Employee">
        <div style={{ padding: "16px 20px" }}>
          <label
            htmlFor="emp-select"
            style={{ display: "block", fontSize: 13, fontWeight: 500, color: "var(--ink2)", marginBottom: 6 }}
          >
            Employee
          </label>
          <select
            id="emp-select"
            value={empId}
            onChange={(e) => setEmpId(e.target.value)}
            style={{
              width: "100%",
              maxWidth: 400,
              padding: "8px 12px",
              borderRadius: 6,
              border: "1px solid var(--line)",
              fontSize: 14,
              background: "var(--bg)",
              color: "var(--ink)",
            }}
          >
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.name} ({e.employeeNo})</option>
            ))}
          </select>
        </div>
      </Card>

      {loading && (
        <p style={{ textAlign: "center", color: "var(--mut)", padding: "24px 0", fontSize: 14 }}>
          Loading balance…
        </p>
      )}
      {error && (
        <p role="alert" style={{ color: "var(--color-error)", fontSize: 14, fontWeight: 500 }}>
          {error}
        </p>
      )}

      {!loading && ctx && (
        ctx.allocations.length === 0 ? (
          <Card title="Leave Entitlement">
            <div style={{ padding: "48px 24px", textAlign: "center", color: "var(--mut)" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>\U0001f334</div>
              <p style={{ fontWeight: 600, marginBottom: 4, color: "var(--ink)" }}>No leave allocated</p>
              <p style={{ fontSize: 14, marginBottom: 16 }}>This employee has no leave allocation for this FY.</p>
              <Link href="/hr/leave/allocate" className="btn primary">Allocate Leave</Link>
            </div>
          </Card>
        ) : (
          <Card title="Leave Entitlement">
            <div style={{ display: "flex", flexDirection: "column", gap: 0, padding: "8px 0" }}>
              {ctx.allocations.map((alloc) => {
                const { total, used, balance } = usedByTypeId(alloc);
                const p = pct(used, total);
                return (
                  <div
                    key={alloc.id}
                    style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)" }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                      <div>
                        <p style={{ fontWeight: 600, color: "var(--ink)", fontSize: 15 }}>{alloc.leaveTypeName}</p>
                        <p style={{ fontSize: 12, color: "var(--mut)", marginTop: 2 }}>FY {alloc.fy} · Code: {alloc.leaveTypeCode}</p>
                      </div>
                      <p style={{ fontSize: 28, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: balance <= 0 ? "var(--bad)" : "var(--good)" }}>
                        {balance}
                        <span style={{ fontSize: 14, fontWeight: 400, color: "var(--mut)" }}> / {total} days</span>
                      </p>
                    </div>
                    <div style={{ height: 8, borderRadius: 4, background: "var(--bg2)", overflow: "hidden" }}>
                      <div
                        style={{
                          height: "100%",
                          width: `${p}%`,
                          borderRadius: 4,
                          background: p >= 90 ? "var(--bad)" : p >= 60 ? "var(--warn)" : "var(--good)",
                          transition: "width 0.4s ease",
                        }}
                        aria-label={`${p}% used`}
                      />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                      <span style={{ fontSize: 12, color: "var(--mut)" }}>{used} used</span>
                      <span style={{ fontSize: 12, color: "var(--mut)" }}>{balance} remaining</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )
      )}
    </main>
  );
}
