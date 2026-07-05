import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getFinanceAuditParas } from "@/app/_data/loaders";
import { AuditParasTable } from "./AuditParasTable";

export default async function AuditParasPage() {
  const { data: paras, source } = await getFinanceAuditParas();
  const open = paras.filter((p) => String(p.status).toLowerCase() === "open").length;
  const replied = paras.filter((p) => String(p.status).toLowerCase() === "replied").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Audit Paras"
        subtitle="CAG audit observations and department responses."
        back="/finance"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />
      <StatGrid>
        <StatCard icon="📋" iconBg="#e7edfd" label="Total Paras" value={paras.length} />
        <StatCard icon="🔴" iconBg="#fce7ee" label="Open" value={open} />
        <StatCard icon="📝" iconBg="#fffaeb" label="Replied" value={replied} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Settled" value={paras.length - open - replied} />
      </StatGrid>
      <Card title="Audit Observations">
        <AuditParasTable paras={paras} source={source === "error" ? "error" : "api"} />
      </Card>
    </main>
  );
}
