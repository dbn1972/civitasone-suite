import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, EmptyState } from "../../../_components/ds";
import { getProcurementAnnualPlans } from "../../../_data/loaders";
import Link from "next/link";

const STATUS_COLOR: Record<string, string> = {
  draft:    "var(--ink2)",
  pending:  "var(--warn)",
  approved: "var(--good)",
  rejected: "var(--bad)",
};

function fmtAmount(minor: string | number): string {
  const v = typeof minor === "number" ? minor : parseInt(minor, 10);
  if (isNaN(v)) return "—";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v / 100);
}

export default async function AnnualProcurementPlanPage() {
  const { data: plans, source } = await getProcurementAnnualPlans();

  return (
    <>
      <PageHeader
        title="Annual Procurement Plans"
        subtitle="GFR 2017 — Ministry-level aggregated procurement intent"
        actions={
          <>
            {source === "error" ? <DataSourceBadge source={source} /> : null}
            <Link href="/procurement/planning/new" className="btn primary">+ New Plan</Link>
          </>
        }
      />

      {!plans || plans.length === 0 ? (
        <EmptyState icon="📋" title="No plans yet" message="Create an annual procurement plan to aggregate department-level demand for the financial year." />
      ) : (
        <div className="card">
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">Plan ID</th>
                  <th scope="col">Year</th>
                  <th scope="col">Title</th>
                  <th scope="col">Department</th>
                  <th scope="col" style={{ textAlign: "right" }}>Total budget</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((plan) => (
                  <tr key={plan.id}>
                    <td><span className="mono" style={{ fontSize: 11 }}>{plan.id.slice(0, 8)}</span></td>
                    <td style={{ fontWeight: 600 }}>FY {plan.planYear}–{(plan.planYear + 1).toString().slice(2)}</td>
                    <td>
                      <Link href={"/procurement/planning/" + plan.id} style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 500 }}>
                        {plan.title}
                      </Link>
                    </td>
                    <td>{plan.department}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtAmount(plan.totalEstimatedMinor)}</td>
                    <td>
                      <span style={{ background: STATUS_COLOR[plan.status] ?? "var(--ink2)", color: "#fff", borderRadius: 3, padding: "2px 8px", fontSize: 12, textTransform: "capitalize" }}>
                        {plan.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
