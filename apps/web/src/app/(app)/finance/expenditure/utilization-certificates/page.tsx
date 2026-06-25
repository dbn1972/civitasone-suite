import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "../../../../_components/ds";
import { getFinanceUCs } from "../../../../_data/loaders";
import { UCsTable } from "./UCsTable";
import { formatMoney } from "@/lib/formatters";

export default async function UCsPage() {
  const { data: ucs, source } = await getFinanceUCs();

  const submitted = ucs.filter((u) => u.status === "submitted" || u.status === "verified").length;
  const pending = ucs.filter((u) => u.status === "pending" || u.status === "rejected").length;
  const totalAmount = ucs.reduce((s, u) => s + u.amount, 0);

  return (
    <>
      <PageHeader
        title="Utilization Certificates"
        subtitle="Submit and track UCs for grants and scheme expenditure."
        actions={
          <>
            <button className="btn ghost">Download Format</button>
            <button className="btn primary">+ New UC</button>
            {source === "error" ? <DataSourceBadge source={source} /> : null}
          </>
        }
      />

      <StatGrid>
        <StatCard icon="📋" iconBg="#e7edfd" label="Total UCs" value={ucs.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Submitted / Verified" value={submitted} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending Submission" value={pending} />
        <StatCard icon="💰" iconBg="#eff6ff" label="Covered Amount" value={formatMoney(totalAmount)} />
      </StatGrid>

      <Card title="Utilization certificates">
        <UCsTable ucs={ucs} source={source} />
      </Card>
    </>
  );
}
