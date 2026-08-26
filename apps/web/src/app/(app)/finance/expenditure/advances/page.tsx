import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "../../../../_components/ds";
import { getFinanceAdvances } from "../../../../_data/loaders";
import { AdvancesTable } from "./AdvancesTable";
import { PrintExportButton } from "../../_components/PrintExportButton";
import { formatMoney } from "@/lib/formatters";

export default async function AdvancesPage() {
  const { data: advances, source } = await getFinanceAdvances();

  const openAdvances = advances.filter((a) => a.status === "active").length;
  const overdue = advances.filter((a) => a.status === "overdue").length;
  // balance/adjustedAmount are bigint-safe minor-unit STRINGs (see
  // packages/types' AdvanceSummary) -- summing with `+` would
  // string-concatenate, so accumulate in BigInt (formatMoney accepts bigint).
  const totalBalance = advances.reduce((s, a) => s + BigInt(a.balance), 0n);
  const settled = advances.filter((a) => a.status === "adjusted").reduce((s, a) => s + BigInt(a.adjustedAmount), 0n);

  return (
    <>
      <PageHeader
        title="Advance Management"
        subtitle="Issue and recover advances against actual expenditure."
        actions={
          <>
            <PrintExportButton label="Ageing" documentTitle="Advance Ageing" />
            <a href="/finance/expenditure/advances/new" className="btn primary">+ New Advance</a>
            {source === "error" ? <DataSourceBadge source={source} /> : null}
          </>
        }
      />

      <StatGrid>
        <StatCard icon="💵" iconBg="#e7edfd" label="Open Advances" value={openAdvances} />
        <StatCard icon="📤" iconBg="#eff6ff" label="Outstanding" value={formatMoney(totalBalance)} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Settled (MTD)" value={formatMoney(settled)} />
        <StatCard icon="⚠️" iconBg="#fef3f2" label="Overdue > 90d" value={overdue} />
      </StatGrid>

      <Card title="Advance management">
        <AdvancesTable advances={advances} source={source} />
      </Card>
    </>
  );
}
