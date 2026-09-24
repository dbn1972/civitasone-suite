import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { DataSourceBadge } from "../../../../../_components/DataSourceBadge";
import { PermissionDenied } from "../../../../../_components/PermissionDenied";
import { PageHeader, Card, StatGrid, StatCard } from "../../../../../_components/ds";
import { getSlipById } from "../../../../../_data/loaders";
import { formatMoney } from "@/lib/formatters";
import { getSessionRoles } from "@/lib/auth/roleGuard";

const SALARY_ADMIN_ROLES = ["payroll_admin", "payroll_officer", "super_admin", "hr_admin"];

export default async function PayslipDetailPage({ params }: { params: { id: string } }) {
  const t = await getTranslations("salarySlipDashboard");
  const roles = getSessionRoles();
  const canView = roles.some((r) => SALARY_ADMIN_ROLES.includes(r));
  if (!canView) {
    return <PermissionDenied module="salary slip details" requiredRoles={SALARY_ADMIN_ROLES} />;
  }

  const { data: slip, source } = await getSlipById(params.id);

  if (!slip) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title={t("title")} back="/hr/payroll/salary-slips" backLabel="Back to Salary Slips" />
        <DataSourceBadge source={source} message="Couldn't load — showing nothing" />
        <Card padding>
          <p style={{ textAlign: "center", color: "var(--color-text-muted)" }}>
            {t("notFoundMessage")}
          </p>
        </Card>
      </div>
    );
  }

  // The summary type has top-level gross/deductions/net — use those for display.
  // The API may return richer fields (earnings/deductions arrays, statutory breakdown)
  // that are not in the typed summary but may arrive in the JSON payload.
  const richSlip = slip as typeof slip & {
    earnings?: Array<{ code: string; name: string; amount: number }>;
    deductionItems?: Array<{ code: string; name: string; amount: number }>;
    statutory?: {
      pfEmployee?: number;
      pfEmployer?: number;
      esiEmployee?: number;
      esiEmployer?: number;
      tds?: number;
    };
  };

  const earnings = richSlip.earnings ?? [];
  const deductionItems = richSlip.deductionItems ?? [];
  const stat = richSlip.statutory;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("titleWithPeriod", { period: slip.payPeriod })}
        subtitle={slip.employeeName}
        back="/hr/payroll/salary-slips" backLabel="Back to Salary Slips"
        actions={
          <>
            <Link
              href={`/hr/payroll/salary-slips/${slip.id}`}
              className="btn secondary"
              style={{ minHeight: 44 }}
            >
              {t("printableSlipLink")}
            </Link>
            <a
              href={`/api/proxy/v1/payroll/slips/${slip.id}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn primary"
              style={{ minHeight: 44 }}
            >
              {t("downloadPdfLink")}
            </a>
          </>
        }
      />

      <DataSourceBadge source={source} message="Couldn't load — showing nothing" />

      {/* Summary cards */}
      <StatGrid>
        <StatCard icon="💰" iconBg="var(--goodbg)" label={t("statGross")} value={formatMoney(slip.gross)} />
        <StatCard icon="📉" iconBg="var(--badbg)" label={t("statDeductions")} value={formatMoney(slip.deductions)} />
        <StatCard icon="✅" iconBg="var(--infobg)" label={t("statNetPay")} value={formatMoney(slip.net)} />
        <StatCard
          icon="📋"
          iconBg="var(--warnbg)"
          label={t("statStatus")}
          value={slip.status.charAt(0).toUpperCase() + slip.status.slice(1)}
        />
      </StatGrid>

      {/* Employee details */}
      <Card title={t("slipDetailsTitle")} padding>
        <div className="fields">
          <div className="field">
            <span className="lbl">{t("fieldEmployee")}</span>
            <span className="val">
              <Link
                href={`/hr/employees/${slip.employeeId}`}
                style={{ color: "var(--primary-d)", fontWeight: 600 }}
              >
                {slip.employeeName}
              </Link>
            </span>
          </div>
          <div className="field">
            <span className="lbl">{t("fieldDepartment")}</span>
            <span className="val">{slip.department}</span>
          </div>
          <div className="field">
            <span className="lbl">{t("fieldPayPeriod")}</span>
            <span className="val">{slip.payPeriod}</span>
          </div>
        </div>
      </Card>

      {/* Earnings table */}
      {earnings.length > 0 ? (
        <Card title={t("earningsTitle")}>
          <table className="tbl">
            <thead>
              <tr>
                <th>{t("colCode")}</th>
                <th>{t("colComponent")}</th>
                <th style={{ textAlign: "right" }}>{t("colAmount")}</th>
              </tr>
            </thead>
            <tbody>
              {earnings.map((row) => (
                <tr key={row.code}>
                  <td>{row.code}</td>
                  <td>{row.name}</td>
                  <td className="num">{formatMoney(row.amount)}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 700, borderTop: "2px solid var(--line)" }}>
                <td colSpan={2}>{t("totalEarnings")}</td>
                <td className="num">{formatMoney(slip.gross)}</td>
              </tr>
            </tbody>
          </table>
        </Card>
      ) : (
        <Card title={t("earningsTitle")} padding>
          <p style={{ color: "var(--color-text-muted)", fontSize: 14 }}>
            {t("earningsUnavailable")}
          </p>
        </Card>
      )}

      {/* Deductions table */}
      {deductionItems.length > 0 ? (
        <Card title={t("deductionsTitle")}>
          <table className="tbl">
            <thead>
              <tr>
                <th>{t("colCode")}</th>
                <th>{t("colComponent")}</th>
                <th style={{ textAlign: "right" }}>{t("colAmount")}</th>
              </tr>
            </thead>
            <tbody>
              {deductionItems.map((row) => (
                <tr key={row.code}>
                  <td>{row.code}</td>
                  <td>{row.name}</td>
                  <td className="num">{formatMoney(row.amount)}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 700, borderTop: "2px solid var(--line)" }}>
                <td colSpan={2}>{t("totalDeductions")}</td>
                <td className="num">{formatMoney(slip.deductions)}</td>
              </tr>
            </tbody>
          </table>
        </Card>
      ) : (
        <Card title={t("deductionsTitle")} padding>
          <p style={{ color: "var(--color-text-muted)", fontSize: 14 }}>
            {t("deductionsUnavailable")}
          </p>
        </Card>
      )}

      {/* Statutory breakdown */}
      <Card title={t("statutoryTitle")} padding>
        {stat ? (
          <div className="fields">
            {stat.pfEmployee != null && (
              <div className="field">
                <span className="lbl">{t("pfEmployee")}</span>
                <span className="val">{formatMoney(stat.pfEmployee)}</span>
              </div>
            )}
            {stat.pfEmployer != null && (
              <div className="field">
                <span className="lbl">{t("pfEmployer")}</span>
                <span className="val">{formatMoney(stat.pfEmployer)}</span>
              </div>
            )}
            {stat.esiEmployee != null && (
              <div className="field">
                <span className="lbl">{t("esiEmployee")}</span>
                <span className="val">{formatMoney(stat.esiEmployee)}</span>
              </div>
            )}
            {stat.esiEmployer != null && (
              <div className="field">
                <span className="lbl">{t("esiEmployer")}</span>
                <span className="val">{formatMoney(stat.esiEmployer)}</span>
              </div>
            )}
            {stat.tds != null && (
              <div className="field">
                <span className="lbl">{t("tds")}</span>
                <span className="val">{formatMoney(stat.tds)}</span>
              </div>
            )}
          </div>
        ) : (
          <p style={{ color: "var(--color-text-muted)", fontSize: 14 }}>
            {t("statutoryUnavailable")}
          </p>
        )}
      </Card>
    </div>
  );
}
