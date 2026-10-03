import { formatMoney, formatIndianDate, formatPayPeriod } from "@/lib/formatters";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import Link from "next/link";
import { PageHeader, RefreshErrorState, Card, maskLast4 } from "../../../../../_components/ds";
import { DataSourceBadge } from "../../../../../_components/DataSourceBadge";
import { PermissionDenied } from "../../../../../_components/PermissionDenied";
import { PrintButton } from "./PrintButton";
import { getSlipById } from "../../../../../_data/loaders";
import { toHumanError } from "@/lib/messages";
import { getTranslations } from "next-intl/server";
import { SALARY_ADMIN_ROLES } from "./_salaryAdminRoles";
import { isPrintableSlipStatus } from "@/lib/payroll/statusLabels";
import { breakdownSlip } from "./slipComponents";
import { getLetterhead } from "./letterhead";
import { LetterheadForm } from "./LetterheadForm";

export default async function SalarySlipPage({ params }: { params: { id: string } }) {
  const t = await getTranslations("salarySlipDetail");
  const roles = getSessionRoles();
  // payroll-critical fix: this used to be SALARY_ADMIN_ROLES-only, so an
  // employee got "Access restricted" on their OWN payslip -- see the
  // matching fix (and its longer comment) in hr/payroll/slips/[id]/page.tsx,
  // this page's sibling view of the same backend slip.
  const canAttempt = roles.some((r) => SALARY_ADMIN_ROLES.includes(r)) || roles.includes("employee");
  if (!canAttempt) {
    return <PermissionDenied module="salary slip details" requiredRoles={SALARY_ADMIN_ROLES} />;
  }

  // GAP-PAYROLL-SALARY-SLIPS-DETAIL-01/03: read through the shared,
  // schema-validated loader (also used by slips/[id]/page.tsx) instead of a
  // private, unvalidated fetch -- both pages now agree on one contract for
  // this one backend endpoint.
  const [{ data: slip, source, status }, { data: letterhead }] = await Promise.all([getSlipById(params.id), getLetterhead()]);
  // Who may edit the issuing organisation (payroll-service PUT /v1/payroll/letterhead).
  const canEditLetterhead = roles.some((r) => ["payroll_admin", "super_admin"].includes(r));
  if (status === 403) {
    return <PermissionDenied module="salary slip details" requiredRoles={SALARY_ADMIN_ROLES} />;
  }
  const errored = source === "error";
  if (errored) {
    return (
      <div className="page-main wrap" style={{ maxWidth: 800 }}>
        <PageHeader title={t("title")} back="/hr/payroll/salary-slips" backLabel="Back to Salary Slips" />
        <div className="pad">
          <RefreshErrorState error={toHumanError("load", { area: "salary slip" })} backHref="/hr/payroll/salary-slips" />
        </div>
      </div>
    );
  }
  if (!slip) {
    // GAP-PAYROLL-SALARY-SLIPS-DETAIL-06: previously called the framework's
    // notFound(), which renders the app's generic 404 with no way back to
    // the slips list -- unlike the sibling slips/[id] page, which already
    // shows a proper not-found card with a back link.
    return (
      <div className="page-main wrap" style={{ maxWidth: 800 }}>
        <PageHeader title={t("title")} back="/hr/payroll/salary-slips" backLabel="Back to Salary Slips" />
        <Card padding>
          <p style={{ textAlign: "center", color: "var(--color-text-muted)" }}>{t("notFoundMessage")}</p>
        </Card>
      </div>
    );
  }

  // GAP-PAYROLL-SALARY-SLIPS-DETAIL-03: no component type is silently dropped,
  // and the listed lines are checked against the slip's own totals.
  const { earnings, deductions, other, earningsMatchGross, deductionsMatchTotal } = breakdownSlip(slip.components, slip.grossMinor, slip.totalDeductionsMinor);
  const canPrint = isPrintableSlipStatus(slip.status);

  return (
    <div className="page-main wrap" style={{ maxWidth: 800 }}>
      {/* GAP-PAYROLL-SALARY-SLIPS-DETAIL-04: the header actions live in PageHeader
          (wraps on a narrow viewport) instead of a hand-built flex row beside it. */}
      <PageHeader
        title={t("title")}
        back="/hr/payroll/salary-slips"
        backLabel="Back to Salary Slips"
        actions={
          <>
            <Link href={`/hr/payroll/slips/${params.id}`} className="btn secondary" style={{ minHeight: 44 }}>{t("dashboardView")}</Link>
            <PrintButton disabled={!canPrint} disabledReason={canPrint ? undefined : t("printUnavailableNotFinal")} />
          </>
        }
      />
      <DataSourceBadge source={source} message={t("loadErrorMessage")} />

      <div id="salary-slip" className="salary-slip-print" style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", borderRadius: 12, padding: 32, fontFamily: "system-ui" }}>
        {/* GAP-PAYROLL-SALARY-SLIPS-DETAIL-02: the issuing organisation is the tenant's
            own (GET /v1/payroll/letterhead). With none configured the slip prints no
            authority line -- no product name, no "Government of India". */}
        {letterhead && (
          <div className="slip-letterhead" style={{ textAlign: "center", marginBottom: 16 }}>
            <div className="slip-logo" style={{ fontSize: 18, fontWeight: 800 }}>{letterhead.orgName}</div>
            {letterhead.department && <div style={{ fontSize: 13 }}>{letterhead.department}</div>}
            {(letterhead.ddoName || letterhead.ddoCode) && (
              <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                {t("ddoLine", { name: letterhead.ddoName ?? "—", code: letterhead.ddoCode ?? "—" })}
              </div>
            )}
            {letterhead.address && <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{letterhead.address}</div>}
          </div>
        )}
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 24, borderBottom: "2px solid var(--ink)", paddingBottom: 16 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{t("heading")}</h1>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: "var(--color-text-muted)" }}>
            {t("payPeriod")} <strong>{formatPayPeriod(slip.payPeriod)}</strong>
          </p>
        </div>

        {/* Employee details */}
        <table style={{ width: "100%", fontSize: 13, marginBottom: 20 }}>
          <tbody>
            <tr>
              <td style={{ padding: "4px 0" }}><strong>{t("employee")}</strong> {slip.employeeName ?? slip.employeeId}</td>
              <td style={{ padding: "4px 0" }}><strong>{t("empNo")}</strong> {slip.employeeNo}</td>
            </tr>
            <tr>
              <td style={{ padding: "4px 0" }}><strong>{t("department")}</strong> {slip.department ?? "—"}</td>
              <td style={{ padding: "4px 0" }}><strong>{t("designation")}</strong> {"—"}</td>
            </tr>
            <tr>
              {/* GAP-PAYROLL-SALARY-SLIPS-DETAIL-05: the backend now resolves
                  and sends ONLY the last 4 digits (queries.ts getSlip) --
                  the full account number never reaches this page at all, so
                  there is nothing left here to mask or to get a fixed-prefix
                  length wrong on. */}
              <td style={{ padding: "4px 0" }}><strong>{t("bankAccount")}</strong> {slip.bankAccountLast4 ? maskLast4(slip.bankAccountLast4) : "—"}</td>
              <td style={{ padding: "4px 0" }}><strong>{t("paidOn")}</strong> {slip.paidDate ? formatIndianDate(slip.paidDate) : t("notYetPaid")}</td>
            </tr>
          </tbody>
        </table>

        {/* Earnings & Deductions side by side */}
        <div className="slip-columns">
          <div>
            <h3 style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", color: "var(--good)", borderBottom: "1px solid var(--goodbd)", paddingBottom: 4, marginBottom: 8 }}>{t("earnings")}</h3>
            <table style={{ width: "100%", fontSize: 13 }}>
              <tbody>
                {earnings.map((c) => (
                  <tr key={c.code}>
                    <td className="cmp-name" style={{ padding: "3px 0" }}>{c.name}</td>
                    <td className="cmp-amount" style={{ padding: "3px 0", textAlign: "right", fontFamily: "monospace" }}>{formatMoney(c.amountMinor)}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: "1px solid var(--color-border)", fontWeight: 700 }}>
                  <td style={{ padding: "6px 0 0" }}>{t("grossEarnings")}</td>
                  <td style={{ padding: "6px 0 0", textAlign: "right", fontFamily: "monospace" }}>{formatMoney(slip.grossMinor)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div>
            <h3 style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", color: "var(--bad)", borderBottom: "1px solid var(--badbd)", paddingBottom: 4, marginBottom: 8 }}>{t("deductions")}</h3>
            <table style={{ width: "100%", fontSize: 13 }}>
              <tbody>
                {deductions.map((c) => (
                  <tr key={c.code}>
                    <td className="cmp-name" style={{ padding: "3px 0" }}>{c.name}</td>
                    <td className="cmp-amount" style={{ padding: "3px 0", textAlign: "right", fontFamily: "monospace" }}>{formatMoney(c.amountMinor)}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: "1px solid var(--color-border)", fontWeight: 700 }}>
                  <td style={{ padding: "6px 0 0" }}>{t("totalDeductions")}</td>
                  <td style={{ padding: "6px 0 0", textAlign: "right", fontFamily: "monospace" }}>{formatMoney(slip.totalDeductionsMinor)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {other.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", color: "var(--mut)", borderBottom: "1px solid var(--line)", paddingBottom: 4, marginBottom: 8 }}>{t("otherComponents")}</h3>
            <table style={{ width: "100%", fontSize: 13 }}>
              <tbody>
                {other.map((c) => (
                  <tr key={c.code}>
                    <td className="cmp-name" style={{ padding: "3px 0" }}>{c.name}</td>
                    <td className="cmp-amount" style={{ padding: "3px 0", textAlign: "right", fontFamily: "monospace" }}>{formatMoney(c.amountMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ margin: "6px 0 0", fontSize: 11, color: "var(--color-text-muted)" }}>{t("otherComponentsNote")}</p>
          </div>
        )}

        {slip.components.length > 0 && (!earningsMatchGross || !deductionsMatchTotal) && (
          <p role="note" className="no-print" style={{ margin: "16px 0 0", fontSize: 12, color: "var(--warn, #92400e)" }}>{t("reconcileNote")}</p>
        )}

        {/* Net Pay */}
        <div style={{ marginTop: 24, padding: "12px 16px", background: "var(--goodbg)", borderRadius: 8, border: "1px solid var(--goodbd)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--good)" }}>{t("netPay")}</span>
          <span style={{ fontSize: 20, fontWeight: 800, color: "var(--good)", fontFamily: "monospace" }}>{formatMoney(slip.netMinor)}</span>
        </div>

        {/* Footer: a signature block when the tenant's letterhead asks for one,
            otherwise the system-generated note. */}
        {letterhead?.showSignatureBlock ? (
          <div style={{ marginTop: 32, display: "flex", justifyContent: "flex-end" }}>
            <div style={{ minWidth: 220, textAlign: "center", fontSize: 12 }}>
              <div style={{ borderTop: "1px solid var(--ink)", paddingTop: 4 }}>
                {letterhead.signatoryTitle ?? t("signatoryFallback")}
              </div>
            </div>
          </div>
        ) : (
          <p style={{ marginTop: 20, fontSize: 11, color: "var(--color-text-muted)", textAlign: "center" }}>
            {t("footer")}
          </p>
        )}
      </div>

      {canEditLetterhead && (
        <details className="no-print" style={{ marginTop: 20 }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>{t("letterheadSummary")}</summary>
          <div style={{ marginTop: 12 }}>
            <LetterheadForm initial={letterhead} />
          </div>
        </details>
      )}
    </div>
  );
}
