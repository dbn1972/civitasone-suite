import { formatMoney } from "@/lib/formatters";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { PageHeader, RefreshErrorState } from "../../../../../_components/ds";
import { DataSourceBadge } from "../../../../../_components/DataSourceBadge";
import { PermissionDenied } from "../../../../../_components/PermissionDenied";
import { PrintButton } from "./PrintButton";
import { toHumanError } from "@/lib/messages";
import { getTranslations } from "next-intl/server";

const SALARY_ADMIN_ROLES = ["payroll_admin", "payroll_officer", "super_admin", "hr_admin"];

type SlipComponent = { code: string; name: string; type: string; amountMinor: number };
type Slip = {
  id: string;
  employeeId: string;
  employeeName?: string;
  employeeNo?: string;
  department?: string;
  designation?: string;
  payPeriod: string;
  basicMinor: number;
  grossMinor: number;
  totalDeductionsMinor: number;
  netMinor: number;
  components: SlipComponent[];
  bankAccount?: string;
  paidDate?: string;
};

async function getSlip(id: string): Promise<LoaderResult<Slip | null>> {
  return fetchJson<unknown, Slip | null>(`/api/v1/payroll/slips/${id}`, null, {
    telemetryKey: "payroll.slip",
    mapResponse: (p) => (p && typeof p === "object" ? p as Slip : null),
  });
}

function fmt(minor: number): string {
  return `₹${(minor / 100).toLocaleString("en-IN")}`;
}

export default async function SalarySlipPage({ params }: { params: { id: string } }) {
  const t = await getTranslations("salarySlipDetail");
  const roles = getSessionRoles();
  const canView = roles.some((r) => SALARY_ADMIN_ROLES.includes(r));
  if (!canView) {
    return <PermissionDenied module="salary slip details" requiredRoles={SALARY_ADMIN_ROLES} />;
  }

  const { data: slip, source } = await getSlip(params.id);
  const errored = source === "error";
  if (errored) {
    return (
      <main className="page-main wrap" style={{ maxWidth: 800 }}>
        <PageHeader title={t("title")} back="/hr/payroll/salary-slips" />
        <div className="pad">
          <RefreshErrorState error={toHumanError("load", { area: "salary slip" })} backHref="/hr/payroll/salary-slips" />
        </div>
      </main>
    );
  }
  if (!slip) notFound();

  const earnings = slip.components.filter((c) => c.type === "earning");
  const deductions = slip.components.filter((c) => c.type === "deduction");

  const maskedAccount = slip.bankAccount
    ? "XXXX-XXXX-" + slip.bankAccount.slice(-4)
    : "—";

  return (
    <main className="page-main wrap" style={{ maxWidth: 800 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <PageHeader title={t("title")} back="/hr/payroll/salary-slips" backLabel="Back to Salary Slips" />
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Link href={`/hr/payroll/slips/${params.id}`} className="btn secondary" style={{ minHeight: 44 }}>{t("dashboardView")}</Link>
          <PrintButton />
        </div>
      </div>
      <DataSourceBadge source={source} message="Couldn't load — showing nothing" />

      <div id="salary-slip" className="salary-slip-print" style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", borderRadius: 12, padding: 32, fontFamily: "system-ui" }}>
        <div className="print-header" aria-hidden="true">
          <div className="slip-logo">CivitasOne HRMS</div>
          <div className="print-meta">Government of India · HR Management System · Salary Slip</div>
        </div>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 24, borderBottom: "2px solid var(--ink)", paddingBottom: 16 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{t("heading")}</h1>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: "var(--color-text-muted)" }}>
            {t("payPeriod")} <strong>{slip.payPeriod}</strong>
          </p>
        </div>

        {/* Employee details */}
        <table style={{ width: "100%", fontSize: 13, marginBottom: 20 }}>
          <tbody>
            <tr>
              <td style={{ padding: "4px 0" }}><strong>{t("employee")}</strong> {slip.employeeName ?? slip.employeeId}</td>
              <td style={{ padding: "4px 0" }}><strong>{t("empNo")}</strong> {slip.employeeNo ?? "—"}</td>
            </tr>
            <tr>
              <td style={{ padding: "4px 0" }}><strong>{t("department")}</strong> {slip.department ?? "—"}</td>
              <td style={{ padding: "4px 0" }}><strong>{t("designation")}</strong> {slip.designation ?? "—"}</td>
            </tr>
            <tr>
              <td style={{ padding: "4px 0" }}><strong>{t("bankAccount")}</strong> {maskedAccount}</td>
              <td style={{ padding: "4px 0" }}><strong>{t("paidOn")}</strong> {slip.paidDate ?? "—"}</td>
            </tr>
          </tbody>
        </table>

        {/* Earnings & Deductions side by side */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <div>
            <h3 style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", color: "var(--good)", borderBottom: "1px solid var(--goodbd)", paddingBottom: 4, marginBottom: 8 }}>{t("earnings")}</h3>
            <table style={{ width: "100%", fontSize: 13 }}>
              <tbody>
                {earnings.map((c) => (
                  <tr key={c.code}>
                    <td style={{ padding: "3px 0" }}>{c.name}</td>
                    <td style={{ padding: "3px 0", textAlign: "right", fontFamily: "monospace" }}>{fmt(c.amountMinor)}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: "1px solid var(--color-border)", fontWeight: 700 }}>
                  <td style={{ padding: "6px 0 0" }}>{t("grossEarnings")}</td>
                  <td style={{ padding: "6px 0 0", textAlign: "right", fontFamily: "monospace" }}>{fmt(slip.grossMinor)}</td>
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
                    <td style={{ padding: "3px 0" }}>{c.name}</td>
                    <td style={{ padding: "3px 0", textAlign: "right", fontFamily: "monospace" }}>{fmt(c.amountMinor)}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: "1px solid var(--color-border)", fontWeight: 700 }}>
                  <td style={{ padding: "6px 0 0" }}>{t("totalDeductions")}</td>
                  <td style={{ padding: "6px 0 0", textAlign: "right", fontFamily: "monospace" }}>{fmt(slip.totalDeductionsMinor)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Net Pay */}
        <div style={{ marginTop: 24, padding: "12px 16px", background: "var(--goodbg)", borderRadius: 8, border: "1px solid var(--goodbd)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--good)" }}>{t("netPay")}</span>
          <span style={{ fontSize: 20, fontWeight: 800, color: "var(--good)", fontFamily: "monospace" }}>{fmt(slip.netMinor)}</span>
        </div>

        {/* Footer */}
        <p style={{ marginTop: 20, fontSize: 11, color: "var(--color-text-muted)", textAlign: "center" }}>
          {t("footer")}
        </p>
      </div>
    </main>
  );
}
