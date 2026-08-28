import Link from "next/link";
import { PageHeader, StatusPill } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getPayrollRunDetails } from "@/app/_data/loaders";

const fmtRupees = (n: number) =>
  "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function PayrollRunsPage() {
  // This used to be a client component fetching "/api/v1/hrms/payroll/runs"
  // directly -- a route that does not exist in hrms-service at all (confirmed
  // live: GET returns 404 "Route GET:/v1/hrms/payroll/runs not found"), so
  // this page ALWAYS landed on its error state, and the empty-state "Create
  // first run ->" CTA it fell back to before that pointed at /hr/payroll/period,
  // a second, independently-broken page (wrong backend: it read finance's GL
  // period-close records, not payroll runs). Switched to the same server-side
  // loader (getPayrollRunDetails -> GET /api/v1/payroll/runs) that the
  // working /hr/payroll root page already uses successfully, and pointed the
  // empty-state CTA at that same working page, where the real
  // CreatePayrollRunForm lives.
  const { data: runs, source } = await getPayrollRunDetails();

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Payroll Runs"
        subtitle="Monthly salary processing and statutory run status."
        back="/hr/payroll"
        backLabel="Payroll"
      />
      <DataSourceBadge source={source} message="Couldn't load payroll runs — showing nothing" />

      {runs.length === 0 ? (
        <div className="card" style={{ padding: 32, textAlign: "center" }}>
          <p style={{ color: "var(--ink2)", fontSize: 15, marginBottom: 14 }}>No payroll runs found.</p>
          <Link href="/hr/payroll" className="btn primary">
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
                      <StatusPill status={run.status} />
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
