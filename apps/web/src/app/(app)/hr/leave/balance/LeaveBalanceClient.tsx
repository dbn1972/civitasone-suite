"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader, StatGrid, StatCard, Card, ErrorState } from "../../../../_components/ds";
import { PrintButton } from "../../../../_components/PrintButton";
import { useTranslations } from "next-intl";
import { toHumanError } from "@/lib/messages";

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

/**
 * Mirrors leave/routes.ts HR_ROLES — the roles that may view ANY employee's
 * leave balance. Others see only their own.
 */
const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const ADMIN_OR_MANAGER_ROLES = [...HR_ROLES, "manager"];

interface Props {
  /** Session roles from the server component wrapper. */
  roles: string[];
  /** The current user's linked employee-record id (null when unlinked). */
  myEmployeeId: string | null;
}

export default function LeaveBalanceClient({ roles, myEmployeeId }: Props) {
  const t = useTranslations("leaveBalance");
  const isAdminOrManager = roles.some((r) => ADMIN_OR_MANAGER_ROLES.includes(r));

  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [empId, setEmpId]         = useState("");
  const [ctx, setCtx]             = useState<LeaveContext | null>(null);
  const [loading, setLoading]     = useState(false);
  const [source, setSource]       = useState<"api" | "error">("api");
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (isAdminOrManager) {
      // Admins/managers: load the full employee picker.
      const controller = new AbortController();
      fetch("/api/proxy/v1/hrms/employees?limit=500", { signal: controller.signal })
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then((body) => {
          const rows: EmployeeOption[] = Array.isArray(body) ? body : (body.data ?? []);
          setEmployees(rows);
          if (rows[0]) setEmpId(rows[0].id);
        })
        .catch((e) => { if (e.name !== "AbortError") { setSource("error"); } });
      return () => controller.abort();
    } else if (myEmployeeId) {
      // Regular employees: show only their own balance.
      setEmpId(myEmployeeId);
    }
  }, [t, isAdminOrManager, myEmployeeId]);

  useEffect(() => {
    if (!empId) return;
    const controller = new AbortController()
    setLoading(true);
    setSource("api");
    fetch(`/api/proxy/v1/hrms/leave-context?employeeId=${encodeURIComponent(empId)}`, { signal: controller.signal })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data: LeaveContext) => setCtx(data))
      .catch((e) => { if (e.name !== "AbortError") { setSource("error"); } })
      .finally(() => setLoading(false));
    return () => controller.abort()
  }, [empId, t, reloadTick]);

  const usedByTypeId = (alloc: Allocation) => {
    const lt = ctx?.leaveTypes.find((leaveType) => leaveType.id === alloc.leaveTypeId);
    const total = lt?.maxDays ?? alloc.balanceDays;
    const used  = total - alloc.balanceDays;
    return { total, used, balance: alloc.balanceDays };
  };

  const pct = (used: number, total: number) =>
    total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;

  const totalTypes       = ctx?.allocations.length ?? 0;
  const totalEntitlement = ctx?.allocations.reduce((s, a) => {
    const lt = ctx?.leaveTypes.find((leaveType) => leaveType.id === a.leaveTypeId);
    return s + (lt?.maxDays ?? a.balanceDays);
  }, 0) ?? 0;
  const totalBalance  = ctx?.allocations.reduce((s, a) => s + a.balanceDays, 0) ?? 0;
  const totalUsed     = totalEntitlement - totalBalance;

  return (
    <div className="page-main wrap leave-balance-print" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/leave" backLabel="Back to Leave"
      />
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }} className="no-print">
        <PrintButton label={t("downloadButton")} />
      </div>

      {ctx && (
        <StatGrid>
          <StatCard icon="🌴" iconBg="var(--goodbg)" label={t("statLeaveTypes")}     value={totalTypes} />
          <StatCard icon="📅" iconBg="var(--infobg)" label={t("statTotalEntitlement")} value={`${totalEntitlement}d`} />
          <StatCard icon="✅"       iconBg="var(--warnbg)" label={t("statTotalUsed")}      value={`${totalUsed}d`} />
          <StatCard icon="⏳"       iconBg="var(--panel)" label={t("statTotalRemaining")} value={`${totalBalance}d`} />
        </StatGrid>
      )}

      {/* Employee picker: visible only to admin/manager roles */}
      {isAdminOrManager && (
        <Card title={t("selectEmployeeCard")}>
          <div style={{ padding: "16px 20px" }}>
            <label
              htmlFor="emp-select"
              style={{ display: "block", fontSize: 13, fontWeight: 500, color: "var(--ink2)", marginBottom: 6 }}
            >
              {t("employeeLabel")}
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
      )}

      {loading && (
        <p style={{ textAlign: "center", color: "var(--mut)", padding: "24px 0", fontSize: 14 }}>
          {t("loadingBalance")}
        </p>
      )}

      {!loading && (
        source === "error" ? (
          <Card title={t("entitlementCard")}>
            <ErrorState
              error={toHumanError("load", { area: "leave balance" })}
              onRetry={() => setReloadTick((n) => n + 1)}
            />
          </Card>
        ) : !ctx ? null : ctx.allocations.length === 0 ? (
          <Card title={t("entitlementCard")}>
            <div style={{ padding: "48px 24px", textAlign: "center", color: "var(--mut)" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🌴</div>
              <p style={{ fontWeight: 600, marginBottom: 4, color: "var(--ink)" }}>{t("noLeaveAllocatedTitle")}</p>
              <p style={{ fontSize: 14, marginBottom: 16 }}>{t("noLeaveAllocatedMessage")}</p>
              <Link href="/hr/leave/allocate" className="btn primary">{t("allocateLeaveLink")}</Link>
            </div>
          </Card>
        ) : (
          <Card title={t("entitlementCard")}>
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
                        <p style={{ fontSize: 12, color: "var(--mut)", marginTop: 2 }}>{t("fyCode", { fy: alloc.fy, code: alloc.leaveTypeCode })}</p>
                      </div>
                      <p style={{ fontSize: 28, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: balance <= 0 ? "var(--bad)" : "var(--good)" }}>
                        {balance}
                        <span style={{ fontSize: 14, fontWeight: 400, color: "var(--mut)" }}>{t("ofTotalDays", { total })}</span>
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
                        aria-label={t("usedPercentAria", { percent: p })}
                      />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                      <span style={{ fontSize: 12, color: "var(--mut)" }}>{t("usedSuffix", { count: used })}</span>
                      <span style={{ fontSize: 12, color: "var(--mut)" }}>{t("remainingSuffix", { count: balance })}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )
      )}
    </div>
  );
}
