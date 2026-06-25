import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "../../../_components/ds";
import { getFinanceDashboard } from "../../../_data/loaders";
import Link from "next/link";
import { BudgetChart } from "./BudgetChart";
import { formatMoney } from "@/lib/formatters";

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
  const { data, source } = await getFinanceDashboard();

  return (
    <>
      <PageHeader
        title="Financial Management"
        subtitle="Budget, expenditure, receipts and treasury — one governed view."
        actions={
          <>
            <button className="btn ghost">FY 2026-27 ▾</button>
            <button className="btn primary">Export MIS</button>
            {source === "error" ? <DataSourceBadge source={source} /> : null}
          </>
        }
      />

      <StatGrid>
        <StatCard
          icon="💰"
          iconBg="#e7edfd"
          label="Budget Utilisation (FY)"
          value={`${data.budgetUtilisationPct.toFixed(1)}%`}
          delta="Approved"
          up={false}
        />
        <StatCard
          icon="📤"
          iconBg="#eff6ff"
          label="Expenditure (YTD)"
          value={formatMoney(data.totalExpenditure)}
          delta={`${data.budgetUtilisationPct.toFixed(1)}%`}
          up={true}
        />
        <StatCard
          icon="📥"
          iconBg="#ecfdf3"
          label="Payments (MTD)"
          value={`${data.paymentsThisMonth} payments this month`}
          up={true}
        />
        <StatCard
          icon="⏳"
          iconBg="#fffaeb"
          label="Pending Approvals"
          value={data.pendingSanctions}
          up={false}
        />
      </StatGrid>

      <Card title="Budget Utilisation">
        <div style={{ padding: 16 }}>
          <BudgetChart utilisationPct={data.budgetUtilisationPct} expenditure={data.totalExpenditure} />
        </div>
      </Card>

      <Card title="Finance Modules">
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
