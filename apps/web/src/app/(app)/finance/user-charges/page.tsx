import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getFinanceUserCharges } from "@/app/_data/loaders";
import { UserChargesTable } from "./UserChargesTable";

export default async function UserChargesPage() {
  const { data: charges, source } = await getFinanceUserCharges();
  const collected = charges.filter((c) => String(c.status).toLowerCase() === "collected").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="User Charges"
        subtitle="Service-wise user charges and fee collections."
        back="/finance"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />
      <StatGrid>
        <StatCard icon="🎫" iconBg="#e7edfd" label="Total Charges" value={charges.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Collected" value={collected} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending" value={charges.length - collected} />
        <StatCard icon="📊" iconBg="#eff6ff" label="Services" value={new Set(charges.map((c) => String(c.service ?? ""))).size} />
      </StatGrid>
      <Card title="User Charges">
        <UserChargesTable charges={charges} source={source === "error" ? "error" : "api"} />
      </Card>
    </main>
  );
}
