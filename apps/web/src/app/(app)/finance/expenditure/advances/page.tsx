import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "../../../../_components/ds";
import { getFinanceAdvances } from "../../../../_data/loaders";
import { AdvancesTable } from "./AdvancesTable";
import { formatMoney } from "@/lib/formatters";

export default async function AdvancesPage() {
  const { data: advances, source } = await getFinanceAdvances();

  const openAdvances = advances.filter((a) => a.status === "active").length;
  const overdue = advances.filter((a) => a.status === "overdue").length;
  const totalBalance = advances.reduce((s, a) => s + a.balance, 0);
  const settled = advances.filter((a) => a.status === "adjusted").reduce((s, a) => s + a.adjustedAmount, 0);

  return (
    <>
      <PageHeader
        title="Advance Management"
        subtitle="Issue and recover advances against actual expenditure."
        actions={
          <>
            <button className="btn ghost">Ageing</button>
            <button className="btn primary">+ New Advance</button>
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
