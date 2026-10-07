import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { DataSourceBadge } from "../../../../../_components/DataSourceBadge";
import { PermissionDenied } from "../../../../../_components/PermissionDenied";
import { PageHeader, Card, StatGrid, StatCard, RefreshErrorState } from "../../../../../_components/ds";
import { getSlipById } from "../../../../../_data/loaders";
import { formatMoney, formatPayPeriod } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { salarySlipStatusLabel, isPrintableSlipStatus } from "@/lib/payroll/statusLabels";
import { SALARY_ADMIN_ROLES } from "./_salaryAdminRoles";

export default async function PayslipDetailPage({ params }: { params: { id: string } }) {
  const t = await getTranslations("salarySlipDashboard");
  const roles = getSessionRoles();
  // payroll-critical fix: this used to be SALARY_ADMIN_ROLES-only, so an
  // employee got "Access restricted" on their OWN payslip -- there was no
  // self-service payslip route anywhere in the app. The backend
  // (GET /v1/payroll/slips/:id) now enforces the real ownership check
  // (employee sees only their own slip, 403 otherwise); this page just needs
  // to stop blocking a plain employee before that check ever runs, and
  // handle the 403 it can now legitimately get back for someone else's slip.
  const canAttempt = roles.some((r) => SALARY_ADMIN_ROLES.includes(r)) || roles.includes("employee");
  const isAdmin = roles.some((r) => SALARY_ADMIN_ROLES.includes(r));
  // GAP-PAYROLL-SLIPS-DETAIL-06: the list this page's own back-link pointed
  // to (/hr/payroll/salary-slips) is admin-only -- an employee following it
  // would land on a 403, even though THIS detail page admits them. There is
  // no self-service "my payslips" list yet (GAP-PAYROLL-SALARY-SLIPS-04), so
  // /hr/payroll is the one back-target every role here can actually open.
  const backHref = isAdmin ? "/hr/payroll/salary-slips" : "/hr/payroll";
  const backLabel = isAdmin ? "Back to Salary Slips" : "Back to Payroll";

  if (!canAttempt) {
    return <PermissionDenied module="salary slip details" requiredRoles={SALARY_ADMIN_ROLES} />;
  }

  const { data: slip, source, status } = await getSlipById(params.id);

  if (status === 403) {
    return <PermissionDenied module="salary slip details" requiredRoles={SALARY_ADMIN_ROLES} />;
  }

  // GAP-PAYROLL-SLIPS-DETAIL-01: a failed fetch (source==='error', e.g. the
  // backend unreachable or a genuine 5xx) used to fall into the exact same
  // "may have been removed or you may not have access" branch as a real
  // 404 -- indistinguishable to whoever's reading it, even though one is
  // retryable and the other isn't. Only a true miss (slip is null AND the
  // fetch itself succeeded) is a real not-found now.
  if (source === "error" && status !== 404) {
    return (
      <div className="page-main wrap">
        <PageHeader title={t("title")} back={backHref} backLabel={backLabel} />
        <div className="pad">
          <RefreshErrorState error={toHumanError("load", { area: "salary slip" })} backHref={backHref} />
        </div>
      </div>
    );
  }

  if (!slip) {
    return (
      <div className="page-main wrap">
        <PageHeader title={t("title")} back={backHref} backLabel={backLabel} />
        <DataSourceBadge source={source} message={t("loadErrorMessage")} />
        <Card padding>
          <p style={{ textAlign: "center", color: "var(--color-text-muted)" }}>
            {t("notFoundMessage")}
          </p>
        </Card>
      </div>
    );
  }

  // GAP-PAYROLL-SLIPS-DETAIL-03: this page used to read earnings/
  // deductionItems/statutory fields payroll-service never actually sends
  // (a cast onto a shape that doesn't exist on the wire), so these tables
  // showed "unavailable" for every real slip. components[] is the real
  // field -- same one the sibling salary-slips/[id] page already reads.
  const earnings = slip.components.filter((c) => c.type === "earning");
  const deductions = slip.components.filter((c) => c.type === "deduction");
  const canDownload = isPrintableSlipStatus(slip.status);

  // GAP-PAYROLL-SLIPS-DETAIL-03: the real statutory columns, not the
  // fictional stat.pfEmployee/esiEmployee/esiEmployer shape. Only rendered
  // when non-zero so a slip genuinely without (say) ESI doesn't show a
  // confusing "₹0.00 ESI" line.
  const statutoryLines = [
    { key: "pfEmployee", amount: slip.pfEmployeeMinor },
    { key: "pfEmployer", amount: slip.pfEmployerMinor },
    { key: "gpf", amount: slip.gpfMinor },
    { key: "npsEmployee", amount: slip.npsEmployeeMinor },
    { key: "npsEmployer", amount: slip.npsEmployerMinor },
    { key: "esi", amount: slip.esiMinor },
    { key: "tds", amount: slip.tdsMinor },
  ].filter((line) => line.amount > 0);
  const hasEmployerContribution = statutoryLines.some((l) => l.key === "pfEmployer" || l.key === "npsEmployer");

  return (
    <div className="page-main wrap">
      <PageHeader
        title={t("titleWithPeriod", { period: formatPayPeriod(slip.payPeriod) })}
        subtitle={slip.employeeName ?? "—"}
        back={backHref} backLabel={backLabel}
        actions={
          <>
            <Link
              href={`/hr/payroll/salary-slips/${slip.id}`}
              className="btn secondary"
              style={{ minHeight: 44 }}
            >
              {t("printableSlipLink")}
            </Link>
            {canDownload ? (
              <a
                href={`/api/proxy/v1/payroll/slips/${slip.id}/pdf`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn primary"
                style={{ minHeight: 44 }}
              >
                {t("downloadPdfLink")}
              </a>
            ) : (
              <span
                className="btn primary"
                aria-disabled="true"
                title={t("downloadUnavailableNotFinal")}
                style={{ minHeight: 44, opacity: 0.5, cursor: "not-allowed", pointerEvents: "none" }}
              >
                {t("downloadPdfLink")}
              </span>
            )}
          </>
        }
      />

      <DataSourceBadge source={source} message={t("loadErrorMessage")} />

      {/* Summary cards */}
      <StatGrid>
        <StatCard icon="💰" iconBg="var(--goodbg)" label={t("statGross")} value={formatMoney(slip.grossMinor)} />
        <StatCard icon="📉" iconBg="var(--badbg)" label={t("statDeductions")} value={formatMoney(slip.totalDeductionsMinor)} />
        <StatCard icon="✅" iconBg="var(--infobg)" label={t("statNetPay")} value={formatMoney(slip.netMinor)} />
        <StatCard
          icon="📋"
          iconBg="var(--warnbg)"
          label={t("statStatus")}
          // GAP-PAYROLL-SLIPS-DETAIL-04: slip.status.charAt(0) had no guard
          // -- an unexpected/malformed status crashed the whole page. Two
          // layers of defense now: SalarySlipDetailSchema rejects a response
          // whose status isn't a real slip status (draft, finalized, computed,
          // approved, paid, held, exception) before this ever renders (surfaces as the RefreshErrorState branch above instead
          // of a crash), and salarySlipStatusLabel (shared with
          // SalarySlipsTable.tsx) falls back to the raw string rather than
          // throwing for any value outside its own known set.
          value={salarySlipStatusLabel(slip.status, t)}
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
                {slip.employeeName ?? "—"}
              </Link>
            </span>
          </div>
          <div className="field">
            <span className="lbl">{t("fieldDepartment")}</span>
            <span className="val">{slip.department ?? "—"}</span>
          </div>
          <div className="field">
            <span className="lbl">{t("fieldPayPeriod")}</span>
            <span className="val">{formatPayPeriod(slip.payPeriod)}</span>
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
                  <td className="num">{formatMoney(row.amountMinor)}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 700, borderTop: "2px solid var(--line)" }}>
                <td colSpan={2}>{t("totalEarnings")}</td>
                <td className="num">{formatMoney(slip.grossMinor)}</td>
              </tr>
            </tbody>
          </table>
        </Card>
      ) : null}

      {/* Deductions table */}
      {deductions.length > 0 ? (
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
              {deductions.map((row) => (
                <tr key={row.code}>
                  <td>{row.code}</td>
                  <td>{row.name}</td>
                  <td className="num">{formatMoney(row.amountMinor)}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 700, borderTop: "2px solid var(--line)" }}>
                <td colSpan={2}>{t("totalDeductions")}</td>
                <td className="num">{formatMoney(slip.totalDeductionsMinor)}</td>
              </tr>
            </tbody>
          </table>
        </Card>
      ) : null}

      {/* GAP-PAYROLL-SLIPS-DETAIL-03: a section with nothing to show is omitted
          (it used to render three identical "not available" cards); one note
          says so when the slip carries no breakdown at all. */}
      {earnings.length === 0 && deductions.length === 0 && statutoryLines.length === 0 && (
        <Card padding>
          <p role="note" style={{ color: "var(--color-text-muted)", fontSize: 14, margin: 0 }}>{t("breakdownUnavailable")}</p>
        </Card>
      )}

      {/* Statutory breakdown */}
      {statutoryLines.length > 0 && (
      <Card title={t("statutoryTitle")} padding>
        {statutoryLines.length > 0 ? (
          <div className="fields">
            {/* GAP-PAYROLL-SLIPS-DETAIL-04: employer contributions (PF/NPS
                employer share) are not deducted from the employee's own
                pay -- shown here for transparency, but without this note an
                employee viewing their own slip could easily read them as
                money taken out of their pay. */}
            {hasEmployerContribution && (
              <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: "0 0 10px" }}>
                {t("employerContributionNote")}
              </p>
            )}
            {statutoryLines.map((line) => (
              <div className="field" key={line.key}>
                <span className="lbl">{t(line.key as Parameters<typeof t>[0])}</span>
                <span className="val">{formatMoney(line.amount)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </Card>
      )}
    </div>
  );
}
