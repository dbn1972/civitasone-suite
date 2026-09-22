import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, StatIcon } from "../../../_components/ds";
import { getFinanceDashboard } from "../../../_data/loaders";
import Link from "next/link";
import { BudgetChart } from "./BudgetChart";
import { PrintExportButton } from "../_components/PrintExportButton";
import { FyFilter } from "../_components/FyFilter";
import { formatMoney, formatPercent } from "@/lib/formatters";
import { getTranslations } from "next-intl/server";

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
  const t = await getTranslations("financeDashboard");
  const { data, source } = await getFinanceDashboard();
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
        subtitle={t("subtitle")}
        help="finance"
        actions={
          <>
            <FyFilter />
            <PrintExportButton label={t("exportMis")} documentTitle="Finance MIS" />
            {source === "error" ? <DataSourceBadge source={source} /> : null}
          </>
        }
      />

      <StatGrid>
        <StatCard
          icon="💰"
          iconBg="#e7edfd"
          label={t("budgetUtilisation")}
          value={errored ? "—" : formatPercent(data.budgetUtilisationPct)}
          delta={errored ? undefined : "Approved"}
          up={false}
        />
        <StatCard
          icon="📤"
          iconBg="#eff6ff"
          label={t("expenditureYtd")}
          value={errored ? "—" : formatMoney(data.totalExpenditure)}
          delta={errored ? undefined : formatPercent(data.budgetUtilisationPct)}
          up={true}
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
          <BudgetChart utilisationPct={data.budgetUtilisationPct} expenditure={data.totalExpenditure} />
        </div>
      </Card>

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
    </>
  );
}
