import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "../../../_components/ds";
import { getFinanceDashboard } from "../../../_data/loaders";
import Link from "next/link";
import { BudgetChart } from "./BudgetChart";
import { PrintExportButton } from "../_components/PrintExportButton";
import { FyFilter } from "../_components/FyFilter";
import { formatMoney } from "@/lib/formatters";
import { serverT } from "@/lib/i18n/server";

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

export default async function FinanceDashboardPage() {
  const t = serverT();
  const { data, source } = await getFinanceDashboard();

  return (
    <>
      <PageHeader
        title={t("finance.title")}
        subtitle={t("finance.subtitle")}
        actions={
          <>
            <FyFilter />
            <PrintExportButton label={t("finance.exportMis")} documentTitle="Finance MIS" />
            {source === "error" ? <DataSourceBadge source={source} /> : null}
          </>
        }
      />

      <StatGrid>
        <StatCard
          icon="💰"
          iconBg="#e7edfd"
          label={t("finance.budgetUtilisation")}
          value={`${data.budgetUtilisationPct.toFixed(1)}%`}
          delta="Approved"
          up={false}
        />
        <StatCard
          icon="📤"
          iconBg="#eff6ff"
          label={t("finance.expenditureYtd")}
          value={formatMoney(data.totalExpenditure)}
          delta={`${data.budgetUtilisationPct.toFixed(1)}%`}
          up={true}
        />
        <StatCard
          icon="📥"
          iconBg="#ecfdf3"
          label={t("finance.paymentsMtd")}
          value={`${data.paymentsThisMonth} ${t("finance.paymentsThisMonth")}`}
          up={true}
        />
        <StatCard
          icon="⏳"
          iconBg="#fffaeb"
          label={t("finance.pendingApprovals")}
          value={data.pendingSanctions}
          up={false}
        />
      </StatGrid>

      <Card title={t("finance.budgetChart")}>
        <div style={{ padding: 16 }}>
          <BudgetChart utilisationPct={data.budgetUtilisationPct} expenditure={data.totalExpenditure} />
        </div>
      </Card>

      <Card title={t("finance.modules")}>
        <div className="grid g-4" style={{ padding: "16px", gap: "12px" }}>
          {QUICK_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="stat"
              style={{ textDecoration: "none", cursor: "pointer" }}
            >
              <div className="top">
                <div className="ic" style={{ background: "#eef2ff" }}>{link.icon}</div>
              </div>
              <div className="lab">{link.label}</div>
            </Link>
          ))}
        </div>
      </Card>
    </>
  );
}
