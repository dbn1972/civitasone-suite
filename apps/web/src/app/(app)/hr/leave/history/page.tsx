"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

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
  pending:   { bg: "#fffbeb", color: "#b45309", label: "Pending" },
  approved:  { bg: "#f0fdf4", color: "#166534", label: "Approved" },
  rejected:  { bg: "#fef2f2", color: "#991b1b", label: "Rejected" },
  cancelled: { bg: "#f8fafc", color: "#64748b", label: "Cancelled" },
};

function fmt(d: string) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

export default function LeaveHistoryPage() {
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [empId, setEmpId] = useState("");
  const [apps, setApps] = useState<LeaveApp[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

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
    fetch(`/api/proxy/v1/hrms/leave/applications?empId=${encodeURIComponent(empId)}&limit=50`)
      .then((r) => r.json())
      .then((body) => {
        const rows: LeaveApp[] = Array.isArray(body) ? body : body.data ?? [];
        setApps(rows);
      })
      .catch(() => setError("Failed to load leave history."))
      .finally(() => setLoading(false));
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
        setCancelError(text || `Cancel failed (${res.status})`);
        return;
      }
      setApps((prev) => prev.map((a) => (a.id === appId ? { ...a, status: "cancelled" } : a)));
    } catch {
      setCancelError("Network error while cancelling.");
    } finally {
      setCancelling(null);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-4xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/hr" className="hover:text-slate-900">HR</Link>
          <span className="mx-2">/</span>
          <Link href="/hr/leave" className="hover:text-slate-900">Leave</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">History</span>
        </nav>

        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Leave History</h1>
            <p className="mt-1 text-sm text-slate-600">View and manage leave applications by employee.</p>
          </div>
          <Link href="/hr/leave/apply" className="btn primary">+ Apply Leave</Link>
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

        {cancelError && (
          <p role="alert" className="text-sm text-red-600 font-medium">{cancelError}</p>
        )}

        {loading && (
          <p className="text-center text-sm text-slate-500 py-6">Loading leave history…</p>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-600 font-medium">{error}</p>
        )}

        {!loading && !error && (
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            {apps.length === 0 ? (
              <div className="p-10 text-center text-slate-500">
                <p className="text-2xl mb-2">🌴</p>
                <p className="font-medium text-slate-700">No leave applications</p>
                <p className="text-sm mt-1">This employee has not applied for any leave yet.</p>
                <Link href="/hr/leave/apply" className="btn primary" style={{ marginTop: 12, display: "inline-block" }}>
                  Apply Leave
                </Link>
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                      {["Leave Type", "From", "To", "Days", "Reason", "Status", ""].map((h) => (
                        <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, color: "#475569", whiteSpace: "nowrap" }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {apps.map((app) => {
                      const chip = STATUS_CHIP[app.status] ?? { bg: "#f8fafc", color: "#475569", label: app.status };
                      const days = app.days ?? app.daysApplied ?? "—";
                      const leaveName = app.leaveTypeName ?? app.leaveType ?? "—";
                      return (
                        <tr key={app.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
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
                            {app.status === "pending" && (
                              <button
                                type="button"
                                onClick={() => void handleCancel(app.id)}
                                disabled={cancelling === app.id}
                                style={{
                                  padding: "4px 12px",
                                  borderRadius: 6,
                                  border: "1px solid #fca5a5",
                                  background: cancelling === app.id ? "#f8fafc" : "#fef2f2",
                                  color: "#991b1b",
                                  fontSize: 12,
                                  fontWeight: 500,
                                  cursor: cancelling === app.id ? "not-allowed" : "pointer",
                                  minHeight: 36,
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
            )}
          </div>
        )}
      </section>
    </main>
  );
}
