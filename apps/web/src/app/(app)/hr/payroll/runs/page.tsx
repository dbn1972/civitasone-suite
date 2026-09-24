import Link from "next/link";
import { PageHeader, StatusPill, RefreshErrorState } from "../../../../_components/ds";
import { getPayrollRunDetails } from "@/app/_data/loaders";
import { useResource } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { getTranslations } from "next-intl/server";

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
  const t = await getTranslations("payrollRuns");
  const result = await getPayrollRunDetails();
  const { data: runs } = result;
  const resource = useResource(result);
  const errored = resource.status === "error";

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll"
        backLabel="Payroll"
      />

      {errored ? (
        <div className="card" style={{ padding: 32 }}>
          <RefreshErrorState error={toHumanError("load", { area: "payroll runs" })} backHref="/hr/payroll" />
        </div>
      ) : runs.length === 0 ? (
        <div className="card" style={{ padding: 32, textAlign: "center" }}>
          <p style={{ color: "var(--ink2)", fontSize: 15, marginBottom: 14 }}>{t("emptyMessage")}</p>
          <Link href="/hr/payroll" className="btn primary">
            {t("createFirstRun")}
          </Link>
        </div>
      ) : (
        <div className="card">
          <div style={{ overflowX: "auto" }}>
            <table className="data-table" role="table" aria-label={t("tableAriaLabel")}>
              <thead>
                <tr>
                  <th scope="col">{t("colPeriod")}</th>
                  <th scope="col" style={{ textAlign: "end" }}>{t("colEmployees")}</th>
                  <th scope="col" style={{ textAlign: "end" }}>{t("colGross")}</th>
                  <th scope="col" style={{ textAlign: "end" }}>{t("colNet")}</th>
                  <th scope="col">{t("colStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <Link href={`/hr/payroll/${run.id}`}>{run.payPeriod}</Link>
                    </td>
                    <td style={{ textAlign: "end" }}>{run.employeeCount.toLocaleString("en-IN")}</td>
                    <td style={{ textAlign: "end" }}>{fmtRupees(run.grossAmount)}</td>
                    <td style={{ textAlign: "end" }}>{fmtRupees(run.netAmount)}</td>
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
    </div>
  );
}
