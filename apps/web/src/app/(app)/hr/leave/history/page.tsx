"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader, StatGrid, StatCard, Card, EmptyState, ConfirmDialog, useConfirmAction } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";

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

const STATUS_CHIP: Record<string, { bg: string; color: string; label: string }> = {
  pending:   { bg: "var(--warnbg)", color: "var(--warn)", label: "Pending" },
  approved:  { bg: "var(--goodbg)", color: "var(--good)", label: "Approved" },
  rejected:  { bg: "var(--badbg)", color: "var(--bad)", label: "Rejected" },
  cancelled: { bg: "#f8fafc", color: "#64748b", label: "Cancelled" },
};

function fmt(d: string) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

export default function LeaveHistoryPage() {
  const [employees, setEmployees]   = useState<EmployeeOption[]>([]);
  const [empId, setEmpId]           = useState("");
  const [apps, setApps]             = useState<LeaveApp[]>([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [source, setSource]         = useState<"api" | "error">("api");
  const [pendingCancel, setPendingCancel] = useState<LeaveApp | null>(null);

  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/proxy/v1/hrms/employees?limit=500", { signal: controller.signal })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((body) => {
        const rows: EmployeeOption[] = Array.isArray(body) ? body : (body.data ?? []);
        setEmployees(rows);
        if (rows[0]) setEmpId(rows[0].id);
      })
      .catch((e) => { if (e.name !== 'AbortError') { setError("Failed to load employees."); setSource("error"); } });
    return () => controller.abort()
  }, []);

  useEffect(() => {
    if (!empId) return;
    const controller = new AbortController()
    setLoading(true);
    setError(null);
    fetch(`/api/proxy/v1/hrms/leave/applications?empId=${encodeURIComponent(empId)}&limit=50`, { signal: controller.signal })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((body) => {
        const rows: LeaveApp[] = Array.isArray(body) ? body : (body.data ?? []);
        setApps(rows);
      })
      .catch((e) => { if (e.name !== 'AbortError') { setError("Failed to load leave history."); setSource("error"); } })
      .finally(() => setLoading(false));
    return () => controller.abort()
  }, [empId]);

  async function handleCancel(appId: string) {
    setCancelling(appId);
    setCancelError(null);
    try {
      const res = await fetch(`/api/proxy/v1/hrms/leave-applications/${appId}/cancel`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(text || `Cancel failed (${res.status})`);
      }
      setApps((prev) => prev.map((a) => (a.id === appId ? { ...a, status: "cancelled" } : a)));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error while cancelling.";
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

  // A leave application can be cancelled while pending OR after approval
  // (hrms-service cancel-route.ts allows status "pending" | "approved" | "draft");
  // only rejected/cancelled applications cannot be.
  const isCancellable = (status: string) => status === "pending" || status === "approved" || status === "draft";

  const approved  = apps.filter((a) => a.status === "approved").length;
  const pending   = apps.filter((a) => a.status === "pending").length;
  const rejected  = apps.filter((a) => a.status === "rejected").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Leave History"
        subtitle="View and manage leave applications by employee."
        back="/hr/leave"
        actions={<Link href="/hr/leave/apply" className="btn primary">+ Apply Leave</Link>}
      />
      <DataSourceBadge source={source} />

      <StatGrid>
        <StatCard icon="📋" iconBg="var(--infobg)" label="Total Applications" value={apps.length} />
        <StatCard icon="\u2705"       iconBg="var(--goodbg)" label="Approved"           value={approved} />
        <StatCard icon="\u23f3"       iconBg="var(--warnbg)" label="Pending"            value={pending} />
        <StatCard icon="\u274c"       iconBg="var(--badbg)" label="Rejected"           value={rejected} />
      </StatGrid>

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

      {cancelError && (
        <p role="alert" style={{ color: "var(--bad)", fontSize: 14, fontWeight: 500 }}>{cancelError}</p>
      )}
      {loading && (
        <p style={{ textAlign: "center", color: "var(--mut)", padding: "24px 0", fontSize: 14 }}>
          Loading leave history…
        </p>
      )}
      {error && (
        <p role="alert" style={{ color: "var(--color-error)", fontSize: 14, fontWeight: 500 }}>{error}</p>
      )}

      {!loading && !error && (
        apps.length === 0 ? (
          <Card title="Applications">
            <EmptyState
              icon="🌴"
              title="No leave applications"
              message="This employee has not applied for any leave yet."
            />
          </Card>
        ) : (
          <Card title="Leave Applications">
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "var(--bg2)", borderBottom: "1px solid var(--line)" }}>
                    {["Leave Type", "From", "To", "Days", "Reason", "Status", ""].map((h) => (
                      <th scope="col"
                        key={h}
                        style={{
                          padding: "10px 14px",
                          textAlign: "left",
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
                    const chip = STATUS_CHIP[app.status] ?? { bg: "var(--bg2)", color: "var(--ink2)", label: app.status };
                    const days = app.days ?? app.daysApplied ?? "—";
                    const leaveName = app.leaveTypeName ?? app.leaveType ?? "—";
                    return (
                      <tr key={app.id} style={{ borderBottom: "1px solid var(--line)" }}>
                        <td style={{ padding: "10px 14px", fontWeight: 500 }}>{leaveName}</td>
                        <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>{fmt(app.fromDate)}</td>
                        <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>{fmt(app.toDate)}</td>
                        <td style={{ padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{days}</td>
                        <td style={{ padding: "10px 14px", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {app.reason ?? "—"}
                        </td>
                        <td style={{ padding: "10px 14px" }}>
                          <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: chip.bg, color: chip.color }}>
                            {chip.label}
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
                                border: "1px solid #fca5a5",
                                background: cancelling === app.id ? "var(--bg2)" : "#fef2f2",
                                color: "var(--color-error-dark)",
                                fontSize: 12,
                                fontWeight: 500,
                                cursor: cancelling === app.id ? "not-allowed" : "pointer",
                                minHeight: 32,
                              }}
                            >
                              {cancelling === app.id ? "Cancelling…" : "Cancel"}
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
        title="Cancel this leave application?"
        description={
          pendingCancel ? (
            <>
              This withdraws the <strong>{pendingCancel.leaveTypeName ?? pendingCancel.leaveType ?? "leave"}</strong>{" "}
              request for {fmt(pendingCancel.fromDate)} – {fmt(pendingCancel.toDate)}
              {pendingCancel.status === "approved" ? " and reverses the approval" : ""}. This cannot be undone —
              a new request would need to be submitted from scratch.
            </>
          ) : null
        }
        danger
        confirmLabel="Cancel leave"
        cancelLabel="Keep it"
        busy={cancelBusy}
        errorMessage={cancelDialogError}
        onConfirm={() => void confirmCancel()}
        onCancel={() => { closeCancelDialog(); setPendingCancel(null); }}
      />
    </main>
  );
}
