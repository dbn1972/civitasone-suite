"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader, StatGrid, StatCard, Card, EmptyState, ErrorState, ConfirmDialog, useConfirmAction } from "../../../../_components/ds";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { toHumanError } from "@/lib/messages";

type EmployeeOption = { id: string; name: string; employeeNo: string };
type LeaveApp = {
  id: string;
  employeeName?: string;
  leaveType?: string;
  leaveTypeName?: string;
  fromDate: string;
  toDate: string;
  days?: number;
  daysApplied?: number;
  status: string;
  reason?: string;
};

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  pending:   { bg: "var(--warnbg)", color: "var(--warn)" },
  approved:  { bg: "var(--goodbg)", color: "var(--good)" },
  rejected:  { bg: "var(--badbg)", color: "var(--bad)" },
  cancelled: { bg: "var(--bg, #f8fafc)", color: "var(--mut, #64748b)" },
};

function fmt(d: string) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

/**
 * Mirrors leave/routes.ts HR_ROLES.
 */
const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const ADMIN_OR_MANAGER_ROLES = [...HR_ROLES, "manager"];

interface Props {
  roles: string[];
  myEmployeeId: string | null;
}

export default function LeaveHistoryClient({ roles, myEmployeeId }: Props) {
  const t = useTranslations("leaveHistory");
  const isAdminOrManager = roles.some((r) => ADMIN_OR_MANAGER_ROLES.includes(r));

  const [employees, setEmployees]   = useState<EmployeeOption[]>([]);
  const [empId, setEmpId]           = useState("");
  const [apps, setApps]             = useState<LeaveApp[]>([]);
  const [loading, setLoading]       = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [source, setSource]         = useState<"api" | "error">("api");
  const [reloadTick, setReloadTick] = useState(0);
  const [pendingCancel, setPendingCancel] = useState<LeaveApp | null>(null);
  const formError = useFormError("leave application");

  const statusLabel: Record<string, string> = {
    pending: t("chipPending"),
    approved: t("chipApproved"),
    rejected: t("chipRejected"),
    cancelled: t("chipCancelled"),
  };

  useEffect(() => {
    if (isAdminOrManager) {
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
      setEmpId(myEmployeeId);
    }
  }, [t, isAdminOrManager, myEmployeeId]);

  useEffect(() => {
    if (!empId) return;
    const controller = new AbortController()
    setLoading(true);
    setSource("api");
    fetch(`/api/proxy/v1/hrms/leave/applications?empId=${encodeURIComponent(empId)}&limit=50`, { signal: controller.signal })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((body) => {
        const rows: LeaveApp[] = Array.isArray(body) ? body : (body.data ?? []);
        setApps(rows);
      })
      .catch((e) => { if (e.name !== "AbortError") { setSource("error"); } })
      .finally(() => setLoading(false));
    return () => controller.abort()
  }, [empId, t, reloadTick]);

  async function handleCancel(appId: string) {
    setCancelling(appId);
    setCancelError(null);
    try {
      const res = await fetch(`/api/proxy/v1/hrms/leave-applications/${appId}/cancel`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        throw new Error(resolved.message);
      }
      setApps((prev) => prev.map((a) => (a.id === appId ? { ...a, status: "cancelled" } : a)));
    } catch (err) {
      const msg = err instanceof Error ? err.message : formError.fromException("save").message;
      setCancelError(msg);
      throw err instanceof Error ? err : new Error(msg);
    } finally {
      setCancelling(null);
    }
  }

  const {
    open: cancelOpen,
    busy: cancelBusy,
    error: cancelDialogError,
    trigger: triggerCancel,
    cancel: closeCancelDialog,
    confirm: confirmCancel,
  } = useConfirmAction({
    onConfirm: async () => {
      if (pendingCancel) await handleCancel(pendingCancel.id);
    },
    onSuccess: () => setPendingCancel(null),
  });

  const isCancellable = (status: string) => status === "pending" || status === "approved" || status === "draft";

  const approved  = apps.filter((a) => a.status === "approved").length;
  const pending   = apps.filter((a) => a.status === "pending").length;
  const rejected  = apps.filter((a) => a.status === "rejected").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/leave"
        actions={<Link href="/hr/leave/apply" className="btn primary">{t("applyLeaveAction")}</Link>}
      />

      <StatGrid>
        <StatCard icon="📋" iconBg="var(--infobg)" label={t("statTotalApplications")} value={apps.length} />
        <StatCard icon="✅"       iconBg="var(--goodbg)" label={t("statApproved")}           value={approved} />
        <StatCard icon="⏳"       iconBg="var(--warnbg)" label={t("statPending")}            value={pending} />
        <StatCard icon="❌"       iconBg="var(--badbg)" label={t("statRejected")}           value={rejected} />
      </StatGrid>

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

      {cancelError && (
        <p role="alert" style={{ color: "var(--bad)", fontSize: 14, fontWeight: 500 }}>{cancelError}</p>
      )}
      {loading && (
        <p style={{ textAlign: "center", color: "var(--mut)", padding: "24px 0", fontSize: 14 }}>
          {t("loadingHistory")}
        </p>
      )}

      {!loading && (
        source === "error" ? (
          <Card title={t("applicationsCard")}>
            <ErrorState
              error={toHumanError("load", { area: "leave history" })}
              onRetry={() => setReloadTick((n) => n + 1)}
            />
          </Card>
        ) : apps.length === 0 ? (
          <Card title={t("applicationsCard")}>
            <EmptyState
              icon="🌴"
              title={t("noApplicationsTitle")}
              message={t("noApplicationsMessage")}
            />
          </Card>
        ) : (
          <Card title={t("leaveApplicationsCard")}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "var(--bg2)", borderBottom: "1px solid var(--line)" }}>
                    {[t("colLeaveType"), t("colFrom"), t("colTo"), t("colDays"), t("colReason"), t("colStatus"), ""].map((h) => (
                      <th scope="col"
                        key={h}
                        style={{
                          padding: "10px 14px",
                          textAlign: "start",
                          fontWeight: 600,
                          color: "var(--ink2)",
                          whiteSpace: "nowrap",
                          fontSize: 12,
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {apps.map((app) => {
                    const style = STATUS_STYLE[app.status] ?? { bg: "var(--bg2)", color: "var(--ink2)" };
                    const label = statusLabel[app.status] ?? app.status;
                    const days = app.days ?? app.daysApplied ?? "—";
                    const leaveName = app.leaveTypeName ?? app.leaveType ?? "—";
                    return (
                      <tr key={app.id} style={{ borderBottom: "1px solid var(--line)" }}>
                        <td style={{ padding: "10px 14px", fontWeight: 500 }}>{leaveName}</td>
                        <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>{fmt(app.fromDate)}</td>
                        <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>{fmt(app.toDate)}</td>
                        <td style={{ padding: "10px 14px", textAlign: "end", fontVariantNumeric: "tabular-nums" }}>{days}</td>
                        <td style={{ padding: "10px 14px", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {app.reason ?? "—"}
                        </td>
                        <td style={{ padding: "10px 14px" }}>
                          <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: style.bg, color: style.color }}>
                            {label}
                          </span>
                        </td>
                        <td style={{ padding: "10px 14px" }}>
                          {isCancellable(app.status) && (
                            <button
                              type="button"
                              onClick={() => { setPendingCancel(app); triggerCancel(); }}
                              disabled={cancelling === app.id}
                              style={{
                                padding: "4px 12px",
                                borderRadius: 6,
                                border: "1px solid var(--badbd, #fca5a5)",
                                background: cancelling === app.id ? "var(--bg2)" : "var(--badbg, #fef2f2)",
                                color: "var(--bad)",
                                fontSize: 12,
                                fontWeight: 500,
                                cursor: cancelling === app.id ? "not-allowed" : "pointer",
                                minHeight: 32,
                              }}
                            >
                              {cancelling === app.id ? t("cancellingBtn") : t("cancelBtn")}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )
      )}

      <ConfirmDialog
        open={cancelOpen}
        title={t("confirmCancelTitle")}
        description={
          pendingCancel ? (
            t.rich("confirmCancelDescription", {
              b: (chunks) => <strong>{chunks}</strong>,
              leaveType: pendingCancel.leaveTypeName ?? pendingCancel.leaveType ?? "leave",
              fromDate: fmt(pendingCancel.fromDate),
              toDate: fmt(pendingCancel.toDate),
              approvedSuffix: pendingCancel.status === "approved" ? t("reversesApprovalSuffix") : "",
            })
          ) : null
        }
        danger
        confirmLabel={t("confirmCancelLabel")}
        cancelLabel={t("keepItLabel")}
        busy={cancelBusy}
        errorMessage={cancelDialogError}
        onConfirm={() => void confirmCancel()}
        onCancel={() => { closeCancelDialog(); setPendingCancel(null); }}
      />
    </main>
  );
}
