import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getFinanceEFT } from "@/app/_data/loaders";
import { EFTTable } from "./EFTTable";

export default async function EftPage() {
  const { data: transfers, source } = await getFinanceEFT();
  const completed = transfers.filter((t) => String(t.status).toLowerCase() === "completed").length;
  const pending = transfers.filter((t) => String(t.status).toLowerCase() === "pending").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Electronic Fund Transfer"
        subtitle="NEFT/RTGS transfers with UTR tracking and settlement status."
        back="/finance"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />
      <StatGrid>
        <StatCard icon="⚡" iconBg="#e7edfd" label="Total Transfers" value={transfers.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Completed" value={completed} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending" value={pending} />
        <StatCard icon="🔄" iconBg="#eff6ff" label="Processing" value={transfers.length - completed - pending} />
      </StatGrid>
      <Card title="EFT Transfers">
        <EFTTable transfers={transfers} source={source === "error" ? "error" : "api"} />
      </Card>
    </main>
  );
}
