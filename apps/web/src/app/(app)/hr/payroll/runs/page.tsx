"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { PageHeader } from "../../../../_components/ds";

type RunStatus = "draft" | "processing" | "approved" | "paid" | "completed" | "failed";

type PayrollRun = {
  id: string;
  payPeriod: string;
  employeeCount: number;
  grossAmount: number;
  netAmount: number;
  status: RunStatus;
};

const STATUS_COLOR: Record<RunStatus, string> = {
  draft: "#6b7280",
  processing: "#d97706",
  approved: "#2563eb",
  paid: "#059669",
  completed: "#059669",
  failed: "#dc2626",
};

const fmtRupees = (n: number) =>
  "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PayrollRunsPage() {
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/hrms/payroll/runs")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((body: { data?: PayrollRun[] }) => {
        setRuns(body.data ?? []);
      })
      .catch(() => {
        setError("Could not load payroll runs. Please try again.");
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  const skeletonCols = 5;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Payroll Runs"
        subtitle="Monthly salary processing and statutory run status."
        back="/hr/payroll"
        backLabel="Payroll"
      />

      {isLoading ? (
        /* Skeleton — prevents empty-state flash during data fetch */
        <div className="animate-pulse" aria-busy="true" aria-label="Loading payroll runs">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: 12,
              marginBottom: 16,
            }}
          >
            {[1, 2, 3, 4].map((n) => (
              <div key={n} style={{ height: 80, borderRadius: 12, background: "var(--panel)" }} />
            ))}
          </div>
          <div className="card">
            <div style={{ overflowX: "auto" }}>
              <table className="data-table" aria-hidden="true">
                <thead>
                  <tr>
                    {[1, 2, 3, 4, 5].map((c) => (
                      <th key={c}>
                        <span
                          style={{
                            display: "block",
                            height: 14,
                            borderRadius: 4,
                            background: "var(--panel)",
                            width: "60%",
                          }}
                        />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                    <tr key={n}>
                      {Array.from({ length: skeletonCols }).map((_, c) => (
                        <td key={c}>
                          <span
                            style={{
                              display: "block",
                              height: 16,
                              borderRadius: 4,
                              background: "var(--panel)",
                            }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : error ? (
        <div
          role="alert"
          style={{
            background: "#fef2f2",
            color: "#b42318",
            border: "1px solid #fecaca",
            borderRadius: 8,
            padding: "10px 14px",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      ) : runs.length === 0 ? (
        <div className="card" style={{ padding: 32, textAlign: "center" }}>
          <p style={{ color: "var(--ink2)", fontSize: 15, marginBottom: 14 }}>No payroll runs found.</p>
          <Link href="/hr/payroll/period" className="btn primary">
            Create first run →
          </Link>
        </div>
      ) : (
        <div className="card">
          <div style={{ overflowX: "auto" }}>
            <table className="data-table" role="table" aria-label="Payroll runs">
              <thead>
                <tr>
                  <th scope="col">Period</th>
                  <th scope="col" style={{ textAlign: "right" }}>Employees</th>
                  <th scope="col" style={{ textAlign: "right" }}>Gross Pay</th>
                  <th scope="col" style={{ textAlign: "right" }}>Net Pay</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <Link href={`/hr/payroll/${run.id}`}>{run.payPeriod}</Link>
                    </td>
                    <td style={{ textAlign: "right" }}>{run.employeeCount.toLocaleString("en-IN")}</td>
                    <td style={{ textAlign: "right" }}>{fmtRupees(run.grossAmount)}</td>
                    <td style={{ textAlign: "right" }}>{fmtRupees(run.netAmount)}</td>
                    <td>
                      <span
                        style={{
                          color: STATUS_COLOR[run.status] ?? "#6b7280",
                          fontWeight: 600,
                          textTransform: "capitalize",
                        }}
                      >
                        {run.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}
