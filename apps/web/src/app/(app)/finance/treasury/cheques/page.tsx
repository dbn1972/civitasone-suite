import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getFinanceCheques } from "@/app/_data/loaders";
import { ChequesTable } from "./ChequesTable";

export default async function ChequesPage() {
  const { data: cheques, source } = await getFinanceCheques();
  const cleared = cheques.filter((c) => String(c.status).toLowerCase() === "cleared").length;
  const presented = cheques.filter((c) => String(c.status).toLowerCase() === "presented").length;
  const bounced = cheques.filter((c) => String(c.status).toLowerCase() === "bounced").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Cheque / DD Register"
        subtitle="Cheque and demand draft register with clearance and bounce tracking."
        back="/finance"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />
      <StatGrid>
        <StatCard icon="📝" iconBg="#e7edfd" label="Total Instruments" value={cheques.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Cleared" value={cleared} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Presented" value={presented} />
        <StatCard icon="❌" iconBg="#fce7ee" label="Bounced" value={bounced} />
      </StatGrid>
      <Card title="Cheque Register">
        <ChequesTable cheques={cheques} source={source === "error" ? "error" : "api"} />
      </Card>
    </main>
  );
}
