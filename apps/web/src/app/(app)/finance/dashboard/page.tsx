import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, StatIcon, LoadErrorState } from "../../../_components/ds";
import { getFinanceDashboard } from "../../../_data/loaders";
import Link from "next/link";
import { BudgetChart } from "./BudgetChart";
import { PrintExportButton } from "../_components/PrintExportButton";
import { FyFilter } from "../_components/FyFilter";
import { formatIndianDateTime, formatMoney, formatPercent } from "@/lib/formatters";
import { getTranslations } from "next-intl/server";
import { currentFinancialYear, recentFinancialYears } from "@/lib/fiscalYear";

const QUICK_LINKS = [
  { label: "Budget Formulation", href: "/finance/budget/formulation", icon: "📝" },
  { label: "Sanctions", href: "/finance/budget/sanctions", icon: "🖊️" },
  { label: "Bill Processing", href: "/finance/expenditure/bills", icon: "🧮" },
  { label: "Advances", href: "/finance/expenditure/advances", icon: "💵" },
  { label: "Utilization Certificates", href: "/finance/expenditure/utilization-certificates", icon: "📋" },
  { label: "General Ledger", href: "/finance/accounting/general-ledger", icon: "📒" },
  { label: "New Voucher", href: "/finance/accounting/vouchers/new", icon: "🖊️" },
  { label: "Financial Statements", href: "/finance/accounting/financial-statements", icon: "📊" },
  { label: "Chart of Accounts", href: "/finance/chart-of-accounts", icon: "🧱" },
  { label: "Payments", href: "/finance/payments", icon: "💳" },
];

export default async function FinanceDashboardPage({ searchParams }: { searchParams?: { fy?: string } }) {
  const t = await getTranslations("financeDashboard");
  // GAP-FINANCE-DASHBOARD-02: ?fy= is validated against the selectable list
  // (never forwarded raw) and drives the loader, so the FyFilter really changes
  // the figures; the applied FY is shown in the subtitle.
  const requestedFy = searchParams?.fy;
  const fy = requestedFy && recentFinancialYears().includes(requestedFy) ? requestedFy : currentFinancialYear();
  const result = await getFinanceDashboard(fy);
  const { data, source } = result;
  // UX-013: `source` was already fetched but only wired to the badge below --
  // never to the stat values themselves, so a failed load rendered "0" /
  // "₹0.00" (data's zero-valued fallback defaults), indistinguishable from a
  // genuine zero. Gate every stat on it, same convention as
  // projects/dashboard and estab/dashboard.
  const errored = source === "error";

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={`${t("subtitle")} · FY ${fy}`}
        help="finance"
        actions={
          <>
            <span className="no-print"><FyFilter /></span>
            {/* GAP-FINANCE-DASHBOARD-06: this is the browser's print dialog, not an
                MIS file export, so it is labelled "Print" until finance-service has
                a real export endpoint. */}
            <PrintExportButton label={t("printPage")} documentTitle={`Finance dashboard FY ${fy}`} />
            {source === "error" ? <DataSourceBadge source={source} /> : null}
          </>
        }
      />

      {/* GAP-FINANCE-DASHBOARD-06: shown only on paper (print-only styles). */}
      <div className="print-header" style={{ display: "none" }}>
        <h1>{t("title")}</h1>
        <div className="print-meta">{t("printMeta", { fy, time: formatIndianDateTime(new Date()) })}</div>
      </div>

      {/* GAP-FINANCE-DASHBOARD-03: the utilisation percentage is shown once (first
          card); the old "Approved" caption and the repeated percentage on the
          expenditure card were not measures, so they are gone. */}
      <StatGrid>
        <StatCard
          icon="💰"
          iconBg="#e7edfd"
          label={t("budgetUtilisation")}
          value={errored ? "—" : formatPercent(data.budgetUtilisationPct)}
        />
        <StatCard
          icon="📤"
          iconBg="#eff6ff"
          label={t("expenditureYtd")}
          value={errored ? "—" : formatMoney(data.totalExpenditure)}
        />
        <StatCard
          icon="📥"
          iconBg="#ecfdf3"
          label={t("paymentsMtd")}
          value={errored ? "—" : `${data.paymentsThisMonth} ${t("paymentsThisMonth")}`}
          up={true}
        />
        <StatCard
          icon="⏳"
          iconBg="#fffaeb"
          label={t("pendingApprovals")}
          value={errored ? "—" : data.pendingSanctions}
          up={false}
        />
      </StatGrid>

      <Card title={t("budgetChart")}>
        <div style={{ padding: 16 }}>
          {/* GAP-FINANCE-DASHBOARD-05: a failed load is not an empty budget; no zero
              donut. 403 -> access-restricted, anything else -> retry. */}
          {errored ? (
            <LoadErrorState result={result} area="the finance dashboard" backHref="/finance" backLabel="Finance" />
          ) : (
            <BudgetChart
              utilisationPct={data.budgetUtilisationPct}
              expenditure={data.totalExpenditure}
              sanctionedMinor={data.sanctionedMinor}
            />
          )}
        </div>
      </Card>

      <div className="no-print">
      <Card title={t("modules")}>
        <div className="grid g-4" style={{ padding: "16px", gap: "12px" }}>
          {QUICK_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="stat"
              style={{ textDecoration: "none", cursor: "pointer" }}
            >
              <div className="top">
                <div className="ic" style={{ background: "#eef2ff" }}>
                  <StatIcon icon={link.icon} />
                </div>
              </div>
              <div className="lab">{link.label}</div>
            </Link>
          ))}
        </div>
      </Card>
      </div>
    </>
  );
}
