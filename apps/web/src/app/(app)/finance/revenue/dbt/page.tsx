import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getFinanceDBT } from "@/app/_data/loaders";
import { DBTTable } from "./DBTTable";

export default async function DbtPage() {
  const { data: beneficiaries, source } = await getFinanceDBT();
  const approved = beneficiaries.filter((b) => String(b.status).toLowerCase() === "approved").length;
  const pending = beneficiaries.filter((b) => String(b.status).toLowerCase() === "pending").length;
  const rejected = beneficiaries.filter((b) => String(b.status).toLowerCase() === "rejected").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="DBT Beneficiaries" subtitle="Direct Benefit Transfer tracking with Aadhaar-linked beneficiary verification." back="/finance" actions={source === "error" ? <DataSourceBadge source={source} /> : null} />
      <StatGrid>
        <StatCard icon="🎯" iconBg="#e7edfd" label="Beneficiaries" value={beneficiaries.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Transferred" value={approved} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending" value={pending} />
        <StatCard icon="❌" iconBg="#fce7ee" label="Rejected" value={rejected} />
      </StatGrid>
      <Card title="DBT Transactions"><DBTTable beneficiaries={beneficiaries} source={source === "error" ? "error" : "api"} /></Card>
    </main>
  );
}
