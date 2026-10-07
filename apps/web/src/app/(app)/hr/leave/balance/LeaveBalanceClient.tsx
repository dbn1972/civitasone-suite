"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader, StatGrid, StatCard, Card, ErrorState, EmptyState, EntityPicker } from "../../../../_components/ds";
import { DataSourceBadge, type DataSource } from "../../../../_components/DataSourceBadge";
import { PrintButton } from "../../../../_components/PrintButton";
import { useTranslations } from "next-intl";
import { toHumanError } from "@/lib/messages";
import { searchEmployees, resolveEmployees } from "@/lib/entityAdapters/employee";

type Allocation = {
  id: string;
  leaveTypeId: string;
  leaveTypeCode: string;
  leaveTypeName: string;
  fy: string;
  /**
   * HIGH fix (negative-balance bug): this EMPLOYEE's actual granted
   * allocation for the year (pro-rated for new joiners, carried-forward, or
   * HR-adjusted) -- NOT the leave type's generic policy cap. See
   * context-routes.ts, which used to omit this field entirely.
   */
  totalDays: number;
  balanceDays: number;
};
type LeaveContext = {
  employee: { id: string; employeeNo: string; name: string };
  leaveTypes: { id: string; code: string; name: string; maxDays: number }[];
  allocations: Allocation[];
};

/**
 * Mirrors leave/routes.ts HR_ROLES -- the roles that may view ANY employee's
 * leave balance. Others see only their own.
 */
const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const ADMIN_OR_MANAGER_ROLES = [...HR_ROLES, "manager"];

interface Props {
  /** Session roles from the server component wrapper. */
  roles: string[];
  /** The current user's linked employee-record id (null when unlinked). */
  myEmployeeId: string | null;
  /**
   * GAP-HR-LEAVE-BALANCE-02: `?empId=` deep-link support, e.g. the leave
   * allocation form's "View full balance" link (AllocateLeaveForm.tsx).
   */
  initialEmployeeId?: string;
  /**
   * GAP-HR-LEAVE-BALANCE-04: true when the session has NO linked employee
   * record (a genuine, expected 404 from /me/profile, not a fetch failure) --
   * shown as an honest "contact HR" empty state instead of a silently blank
   * page.
   */
  noLinkedProfile: boolean;
  /** GAP-HR-LEAVE-BALANCE-05: surfaced via DataSourceBadge near the header. */
  profileSource: DataSource;
}

export default function LeaveBalanceClient({ roles, myEmployeeId, initialEmployeeId, noLinkedProfile, profileSource }: Props) {
  const t = useTranslations("leaveBalance");
  const tc = useTranslations("common");
  const isAdminOrManager = roles.some((r) => ADMIN_OR_MANAGER_ROLES.includes(r));
  const canAllocate = roles.some((r) => HR_ROLES.includes(r));

  // GAP-HR-LEAVE-BALANCE-02: initialise to the deep-linked id, else the
  // caller's own record, else '' (prompt) -- for EVERY role, not just
  // managers. Replaces the old setEmpId(rows[0].id) auto-select, which
  // silently showed an arbitrary employee's balance by default.
  const [empId, setEmpId] = useState(initialEmployeeId ?? myEmployeeId ?? "");
  const [ctx, setCtx]             = useState<LeaveContext | null>(null);
  const [loading, setLoading]     = useState(false);
  const [source, setSource]       = useState<"api" | "error">("api");
  const [reloadTick, setReloadTick] = useState(0);

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

  // HIGH fix (leave-balance negative-number bug, e.g. "Total Used: -4d"
  // observed live): this used to fall back to the leave TYPE's generic
  // policy cap (ctx.leaveTypes[].maxDays -- a per-tenant constant such as
  // "EL: 30 days/year") as the denominator for "days used". That is not
  // this employee's actual allocation for the year: hrmsLeaveAllocs.totalDays
  // is (pro-rated for new joiners, carried forward, or HR-adjusted, so it
  // can legitimately be HIGHER than the generic maxDays). Whenever it was,
  // "used = maxDays - balanceDays" went negative. alloc.totalDays is this
  // specific employee's real granted total for this allocation row -- use
  // that as the denominator instead.
  const usedByTypeId = (alloc: Allocation) => {
    const total = alloc.totalDays;
    const used  = total - alloc.balanceDays;
    return { total, used, balance: alloc.balanceDays };
  };

  const pct = (used: number, total: number) =>
    total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;

  const totalTypes = ctx?.allocations.length ?? 0;

  // GAP-HR-LEAVE-BALANCE-04: a plain employee with no linked record gets an
  // honest explanation instead of a page that renders nothing beyond the
  // header once `empId` never resolves. Checked before any leave-context
  // fetch would even fire (empId stays '' in that case).
  if (!isAdminOrManager && noLinkedProfile) {
    return (
      <div className="page-main wrap leave-balance-print">
        <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr/leave" backLabel={tc("backToLeave")} />
        <Card title={t("entitlementCard")}>
          <EmptyState icon="🪪" title={t("noLinkedProfileTitle")} message={t("noLinkedProfileMessage")} />
        </Card>
      </div>
    );
  }
  if (!isAdminOrManager && profileSource === "error") {
    return (
      <div className="page-main wrap leave-balance-print">
        <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr/leave" backLabel={tc("backToLeave")} />
        <Card title={t("entitlementCard")}>
          <ErrorState error={toHumanError("load", { area: "your profile" })} onRetry={() => setReloadTick((n) => n + 1)} />
        </Card>
      </div>
    );
  }

  return (
    <div className="page-main wrap leave-balance-print">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/leave" backLabel={tc("backToLeave")}
      />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }} className="no-print">
        <DataSourceBadge source={profileSource} />
        <PrintButton label={t("downloadButton")} />
      </div>

      {ctx && (
        <StatGrid>
          <StatCard icon="🌴" iconBg="var(--goodbg)" label={t("statLeaveTypes")} value={totalTypes} />
        </StatGrid>
      )}

      {/* Employee picker: visible only to admin/manager roles */}
      {isAdminOrManager && (
        <Card title={t("selectEmployeeCard")}>
          <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
            <label
              htmlFor="emp-picker"
              style={{ display: "block", fontSize: 13, fontWeight: 500, color: "var(--ink2)" }}
            >
              {t("employeeLabel")}
            </label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ minWidth: 260, maxWidth: 400, flex: "1 1 260px" }}>
                <EntityPicker
                  id="emp-picker"
                  value={empId || null}
                  onChange={(v) => setEmpId(typeof v === "string" ? v : "")}
                  search={searchEmployees}
                  resolve={resolveEmployees}
                  placeholder={t("employeeLabel")}
                  aria-label={t("employeeLabel")}
                />
              </div>
              {myEmployeeId && empId !== myEmployeeId && (
                <button type="button" className="btn ghost" onClick={() => setEmpId(myEmployeeId)}>
                  {t("viewMyBalanceLink")}
                </button>
              )}
            </div>
            {!empId && (
              <p style={{ fontSize: 13, color: "var(--mut)", margin: 0 }}>{t("selectEmployeePrompt")}</p>
            )}
          </div>
        </Card>
      )}

      {loading && (
        <p style={{ textAlign: "center", color: "var(--mut)", padding: "24px 0", fontSize: 14 }}>
          {t("loadingBalance")}
        </p>
      )}

      {!loading && empId && (
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
              {/* GAP-HR-LEAVE-BALANCE-03: this link used to render for every
                  role, including managers/employees who are denied on
                  /hr/leave/allocate (PermissionDenied). */}
              {canAllocate ? (
                <Link href="/hr/leave/allocate" className="btn primary">{t("allocateLeaveLink")}</Link>
              ) : (
                <p style={{ fontSize: 13, color: "var(--mut)" }}>{t("contactHrToAllocateMessage")}</p>
              )}
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
