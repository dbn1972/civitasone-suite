import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getFinanceAuditParas } from "@/app/_data/loaders";
import { AuditParasTable } from "./AuditParasTable";

export default async function AuditParasPage() {
  const { data: paras, source } = await getFinanceAuditParas();
  // Valid statuses are the DB CHECK's open|responded|settled|escalated|dropped
  // (audit/routes.ts) — "replied" is not one of them, so that bucket was
  // always 0 and everything else (including escalated/dropped objections)
  // silently fell into "Settled", which is actively misleading for a
  // compliance page.
  const open = paras.filter((p) => String(p.status).toLowerCase() === "open").length;
  const responded = paras.filter((p) => String(p.status).toLowerCase() === "responded").length;
  const settled = paras.filter((p) => String(p.status).toLowerCase() === "settled").length;

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
        <StatCard icon="📝" iconBg="#fffaeb" label="Responded" value={responded} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Settled" value={settled} />
      </StatGrid>
      <Card title="Audit Observations">
        <AuditParasTable paras={paras} source={source === "error" ? "error" : "api"} />
      </Card>
    </main>
  );
}
