"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  PageHeader, StatGrid, StatCard, Card, EmptyState, ErrorState, ConfirmDialog, useConfirmAction,
  DataTable, StatusPill,
} from "../../../../_components/ds";
import { DataSourceBadge, type DataSource } from "../../../../_components/DataSourceBadge";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { toHumanError } from "@/lib/messages";
import { formatIndianDate, humanizeStatus } from "@/lib/formatters";

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

type HistoryRow = {
  id: string;
  leaveTypeDisplay: string;
  fromDate: string;
  toDate: string;
  daysDisplay: number;
  reasonDisplay: string;
  status: string;
  statusDisplay: string;
};

/**
 * Mirrors leave/routes.ts HR_ROLES.
 */
const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const ADMIN_OR_MANAGER_ROLES = [...HR_ROLES, "manager"];

interface Props {
  roles: string[];
  myEmployeeId: string | null;
  /** GAP-HR-LEAVE-HISTORY-04 (shared with BALANCE-02): `?empId=` deep-link. */
  initialEmployeeId?: string;
  /** GAP-HR-LEAVE-BALANCE-04, applies to history too per that item's fix steps. */
  noLinkedProfile: boolean;
  profileSource: DataSource;
}

export default function LeaveHistoryClient({ roles, myEmployeeId, initialEmployeeId, noLinkedProfile, profileSource }: Props) {
  const t = useTranslations("leaveHistory");
  const isAdminOrManager = roles.some((r) => ADMIN_OR_MANAGER_ROLES.includes(r));

  // GAP-HR-LEAVE-HISTORY-04: initialise to the deep-linked id, else the
  // caller's own record, else '' (prompt) -- replaces setEmpId(rows[0].id),
  // which let a manager cancel an arbitrary direct report's approved leave
  // from the default view, with no reason required, and never showed the
  // manager their OWN history by default.
  const [employees, setEmployees]   = useState<EmployeeOption[]>([]);
  const [empId, setEmpId]           = useState(initialEmployeeId ?? myEmployeeId ?? "");
  const [apps, setApps]             = useState<LeaveApp[]>([]);
  const [total, setTotal]           = useState(0);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [loading, setLoading]       = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [source, setSource]         = useState<"api" | "error">("api");
  // GAP-HR-LEAVE-BALANCE-05 (fix step 4: "apply the same empError split in
  // LeaveHistoryClient"): the employee-list fetch failure used to set the
  // same source==="error" as a balance/history fetch failure, and its Retry
  // (reloadTick) never re-ran the employees effect at all -- see that
  // effect's own dependency array below.
  const [empError, setEmpError]     = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [pendingCancel, setPendingCancel] = useState<LeaveApp | null>(null);
  const formError = useFormError("leave application");

  const statusLabel: Record<string, string> = {
    pending: t("chipPending"),
    approved: t("chipApproved"),
    rejected: t("chipRejected"),
    cancelled: t("chipCancelled"),
    routing_failed: t("chipRoutingFailed"),
    // GAP-HR-LEAVE-HISTORY-05: "draft" is cancellable (isCancellable below)
    // but had no label/style entry at all, so it fell back to the raw
    // word "draft" with the default grey style.
    draft: t("chipDraft"),
  };

  useEffect(() => {
    if (!isAdminOrManager) return;
    const controller = new AbortController();
    setEmpError(false);
    fetch("/api/proxy/v1/hrms/employees?limit=500", { signal: controller.signal })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((body) => {
        const rows: EmployeeOption[] = Array.isArray(body) ? body : (body.data ?? []);
        setEmployees(rows);
        // GAP-HR-LEAVE-HISTORY-04 (fix step 1): no more setEmpId(rows[0].id)
        // here -- a manager used to land on an arbitrary direct report (HR
        // on an arbitrary tenant employee) by default, and could cancel
        // their approved leave with no reason from that very first screen.
        // `empId` is now seeded once, from `initialEmployeeId ?? myEmployeeId`,
        // by the useState initializer above.
      })
      .catch((e) => { if (e.name !== "AbortError") { setEmpError(true); } });
    return () => controller.abort();
    // `reloadTick` is a dependency so Retry on an employee-list failure
    // actually re-fires this effect -- previously Retry only bumped
    // reloadTick, which the balance/history fetch effect depended on but
    // this one didn't, so Retry silently did nothing after this specific
    // failure (GAP-HR-LEAVE-BALANCE-05, fix step 4: "apply the same
    // empError split in LeaveHistoryClient").
  }, [isAdminOrManager, reloadTick]);

  useEffect(() => {
    if (!empId) { setApps([]); setTotal(0); setStatusCounts({}); return; }
    const controller = new AbortController()
    setLoading(true);
    setSource("api");
    // GAP-HR-LEAVE-HISTORY-01: clear the previous employee's rows/counts
    // immediately -- previously a failed fetch left the prior employee's
    // array in state, so the tiles (rendered unconditionally) showed
    // stale counts above the error card, and switching employees could
    // flash the old employee's table for a frame.
    setApps([]); setTotal(0); setStatusCounts({});
    fetch(`/api/proxy/v1/hrms/leave/applications?empId=${encodeURIComponent(empId)}&limit=50`, { signal: controller.signal })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((body) => {
        const rows: LeaveApp[] = Array.isArray(body) ? body : (body.data ?? []);
        const meta = (!Array.isArray(body) ? body.meta : undefined) ?? {};
        setApps(rows);
        setTotal(typeof meta.total === "number" ? meta.total : rows.length);
        setStatusCounts((meta.statusCounts as Record<string, number> | undefined) ?? {});
      })
      .catch((e) => { if (e.name !== "AbortError") { setSource("error"); setApps([]); setTotal(0); setStatusCounts({}); } })
      .finally(() => setLoading(false));
    return () => controller.abort()
  }, [empId, t, reloadTick]);

  async function handleCancel(appId: string, reason?: string) {
    setCancelling(appId);
    setCancelError(null);
    try {
      const res = await fetch(`/api/proxy/v1/hrms/leave-applications/${appId}/cancel`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reason ? { reason } : {}),
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
    // GAP-HR-LEAVE-HISTORY-04: this callback used to ignore the reason
    // ConfirmDialog already hands it (`onConfirm: async () => {...}`,
    // discarding the one argument it was given) instead of forwarding it to
    // handleCancel -- useConfirmAction/ActionButton's own `confirm(reason)`
    // already threads a reason through correctly; the gap was only here.
    onConfirm: async (reason) => {
      if (pendingCancel) await handleCancel(pendingCancel.id, reason);
    },
    onSuccess: () => setPendingCancel(null),
  });

  const isCancellable = (status: string) => status === "pending" || status === "approved" || status === "draft";
  // GAP-HR-LEAVE-HISTORY-04 (fix step 2): a reason is mandatory when
  // cancelling reverses a completed approval, OR when an admin/manager is
  // acting on someone else's leave (every row shown is the currently
  // selected `empId`'s, so "someone else" reduces to "the selected
  // employee isn't the actor's own linked record").
  const cancellingSomeoneElse = isAdminOrManager && !!empId && empId !== myEmployeeId;
  const cancelReasonRequired = pendingCancel?.status === "approved" || cancellingSomeoneElse;

  const tilesReady = !loading && source === "api" && !!empId;
  const cancelledCount = statusCounts.cancelled ?? 0;
  const draftCount = statusCounts.draft ?? 0;
  // GAP-HR-LEAVE-HISTORY-05: "Total" used to be apps.length, which included
  // cancelled/draft rows that no tile represents, so it never equalled the
  // sum of the visible tiles. Relabelled "Active applications" and computed
  // from the server's real per-status total, excluding those two statuses.
  const activeTotal = total - cancelledCount - draftCount;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/leave" backLabel="Back to Leave"
        actions={<Link href="/hr/leave/apply" className="btn primary">{t("applyLeaveAction")}</Link>}
      />
      <div className="no-print" style={{ marginBottom: 8 }}>
        <DataSourceBadge source={profileSource} />
      </div>

      {!isAdminOrManager && noLinkedProfile ? (
        <Card title={t("applicationsCard")}>
          <EmptyState icon="🪪" title={t("noLinkedProfileTitle")} message={t("noLinkedProfileMessage")} />
        </Card>
      ) : !isAdminOrManager && profileSource === "error" ? (
        <Card title={t("applicationsCard")}>
          <ErrorState error={toHumanError("load", { area: "your profile" })} onRetry={() => setReloadTick((n) => n + 1)} />
        </Card>
      ) : (
        <>
          <StatGrid>
            <StatCard icon="📋" iconBg="var(--infobg)" label={t("statTotalApplications")} value={tilesReady ? activeTotal : "—"} />
            <StatCard icon="✅" iconBg="var(--goodbg)" label={t("statApproved")} value={tilesReady ? (statusCounts.approved ?? 0) : "—"} />
            <StatCard icon="⏳" iconBg="var(--warnbg)" label={t("statPending")} value={tilesReady ? (statusCounts.pending ?? 0) : "—"} />
            <StatCard icon="❌" iconBg="var(--badbg)" label={t("statRejected")} value={tilesReady ? (statusCounts.rejected ?? 0) : "—"} />
            {tilesReady && (statusCounts.routing_failed ?? 0) > 0 && (
              <StatCard icon="⚠️" iconBg="var(--badbg)" label={t("statRoutingFailed")} value={statusCounts.routing_failed ?? 0} />
            )}
          </StatGrid>

          {/* Employee picker: visible only to admin/manager roles */}
          {isAdminOrManager && (
            <Card title={t("selectEmployeeCard")}>
              <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
                <label htmlFor="emp-select" style={{ display: "block", fontSize: 13, fontWeight: 500, color: "var(--ink2)" }}>
                  {t("employeeLabel")}
                </label>
                {empError ? (
                  <ErrorState error={toHumanError("load", { area: "employee list" })} onRetry={() => setReloadTick((n) => n + 1)} />
                ) : (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <select
                      id="emp-select"
                      value={empId}
                      onChange={(e) => setEmpId(e.target.value)}
                      style={{
                        width: "100%", maxWidth: 400, padding: "8px 12px", borderRadius: 6,
                        border: "1px solid var(--line)", fontSize: 14, background: "var(--bg)", color: "var(--ink)",
                      }}
                    >
                      <option value="">{t("selectEmployeePrompt")}</option>
                      {employees.map((e) => (
                        <option key={e.id} value={e.id}>{e.name} ({e.employeeNo})</option>
                      ))}
                    </select>
                    {myEmployeeId && empId !== myEmployeeId && (
                      <button type="button" className="btn ghost" onClick={() => setEmpId(myEmployeeId)}>
                        {t("viewMyHistoryLink")}
                      </button>
                    )}
                  </div>
                )}
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

          {!loading && empId && (
            source === "error" ? (
              <Card title={t("applicationsCard")}>
                <ErrorState
                  error={toHumanError("load", { area: "leave history" })}
                  onRetry={() => setReloadTick((n) => n + 1)}
                />
              </Card>
            ) : apps.length === 0 ? (
              <Card title={t("applicationsCard")}>
                <EmptyState icon="🌴" title={t("noApplicationsTitle")} message={t("noApplicationsMessage")} />
              </Card>
            ) : (
              <HistoryTable
                apps={apps}
                statusLabel={statusLabel}
                isCancellable={isCancellable}
                cancelling={cancelling}
                onCancelClick={(app) => { setPendingCancel(app); triggerCancel(); }}
                caption={t("leaveApplicationsCard")}
                colLeaveType={t("colLeaveType")}
                colFrom={t("colFrom")}
                colTo={t("colTo")}
                colDays={t("colDays")}
                colReason={t("colReason")}
                colStatus={t("colStatus")}
                cancelBtnLabel={t("cancelBtn")}
                cancellingBtnLabel={t("cancellingBtn")}
                routingFailedExplanation={t("routingFailedExplanation")}
                showingOfTotal={apps.length < total ? t("showingOfTotal", { shown: apps.length, total }) : null}
              />
            )
          )}
        </>
      )}

      <ConfirmDialog
        open={cancelOpen}
        title={t("confirmCancelTitle")}
        description={
          pendingCancel ? (
            t.rich("confirmCancelDescription", {
              b: (chunks) => <strong>{chunks}</strong>,
              leaveType: pendingCancel.leaveTypeName ?? pendingCancel.leaveType ?? "leave",
              fromDate: formatIndianDate(pendingCancel.fromDate),
              toDate: formatIndianDate(pendingCancel.toDate),
              approvedSuffix: pendingCancel.status === "approved" ? t("reversesApprovalSuffix") : "",
            })
          ) : null
        }
        danger
        confirmLabel={t("confirmCancelLabel")}
        cancelLabel={t("keepItLabel")}
        busy={cancelBusy}
        errorMessage={cancelDialogError}
        requireReason={cancelReasonRequired}
        optionalReason
        reasonLabel={t("cancelReasonLabel")}
        maxReasonLength={500}
        onConfirm={(reason) => void confirmCancel(reason)}
        onCancel={() => { closeCancelDialog(); setPendingCancel(null); }}
      />
    </div>
  );
}

/**
 * GAP-HR-LEAVE-HISTORY-02: hand-rolled <table> (no sort/filter/pagination,
 * Reason truncated with no way to read the full text) replaced with the
 * shared ds DataTable. Split into its own function only so the row-shape
 * normalisation (HistoryRow) doesn't visually compete with the page's
 * loading/error/empty-state branching above.
 */
function HistoryTable({
  apps, statusLabel, isCancellable, cancelling, onCancelClick, caption,
  colLeaveType, colFrom, colTo, colDays, colReason, colStatus,
  cancelBtnLabel, cancellingBtnLabel, routingFailedExplanation, showingOfTotal,
}: {
  apps: LeaveApp[];
  statusLabel: Record<string, string>;
  isCancellable: (status: string) => boolean;
  cancelling: string | null;
  onCancelClick: (app: LeaveApp) => void;
  caption: string;
  colLeaveType: string; colFrom: string; colTo: string; colDays: string; colReason: string; colStatus: string;
  cancelBtnLabel: string; cancellingBtnLabel: string; routingFailedExplanation: string;
  showingOfTotal: string | null;
}) {
  const byId = useMemo(() => new Map(apps.map((a) => [a.id, a])), [apps]);
  const rows: HistoryRow[] = useMemo(() => apps.map((a) => ({
    id: a.id,
    leaveTypeDisplay: a.leaveTypeName ?? a.leaveType ?? "—",
    fromDate: a.fromDate,
    toDate: a.toDate,
    daysDisplay: a.days ?? a.daysApplied ?? 0,
    // GAP-HR-LEAVE-HISTORY-02: full reason available via the cell's title
    // attribute + a 2-line clamp, instead of a hard nowrap+ellipsis that
    // hid it with no way to read the rest.
    reasonDisplay: a.reason ?? "—",
    status: a.status,
    statusDisplay: statusLabel[a.status] ?? humanizeStatus(a.status),
  })), [apps, statusLabel]);

  return (
    <Card title={caption}>
      {showingOfTotal && (
        <p style={{ padding: "8px 20px 0", margin: 0, fontSize: 12, color: "var(--mut)" }}>{showingOfTotal}</p>
      )}
      <DataTable<HistoryRow & Record<string, unknown>>
        columns={[
          { key: "leaveTypeDisplay", label: colLeaveType, sortable: true },
          { key: "fromDate", label: colFrom, cellType: "date", sortable: true },
          { key: "toDate", label: colTo, cellType: "date", sortable: true },
          { key: "daysDisplay", label: colDays, align: "right", sortable: true },
          {
            key: "reasonDisplay", label: colReason,
            render: (row) => (
              <span
                title={row.reasonDisplay}
                style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", maxWidth: 260 }}
              >
                {row.reasonDisplay}
              </span>
            ),
          },
          {
            key: "statusDisplay", label: colStatus, sortable: true,
            render: (row) => (
              <>
                <StatusPill status={row.status} label={row.statusDisplay} />
                {row.status === "routing_failed" && (
                  <div role="alert" style={{ marginTop: 4, fontSize: 11, color: "var(--bad)", maxWidth: 220 }}>
                    {routingFailedExplanation}
                  </div>
                )}
              </>
            ),
          },
          {
            key: "id", label: "",
            render: (row) => {
              const app = byId.get(row.id);
              if (!app || !isCancellable(app.status)) return null;
              return (
                <button
                  type="button"
                  onClick={() => onCancelClick(app)}
                  disabled={cancelling === app.id}
                  style={{
                    padding: "4px 12px", borderRadius: 6, border: "1px solid var(--badbd, #fca5a5)",
                    background: cancelling === app.id ? "var(--bg2)" : "var(--badbg, #fef2f2)",
                    color: "var(--bad)", fontSize: 12, fontWeight: 500,
                    cursor: cancelling === app.id ? "not-allowed" : "pointer", minHeight: 32,
                  }}
                >
                  {cancelling === app.id ? cancellingBtnLabel : cancelBtnLabel}
                </button>
              );
            },
          },
        ]}
        rows={rows}
        rowKey={(r) => r.id}
        sortable
        filterable
        filterKeys={["leaveTypeDisplay", "reasonDisplay", "statusDisplay"]}
        pageSize={15}
        caption={caption}
      />
    </Card>
  );
}
