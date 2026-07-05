import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getFinanceLicenses } from "@/app/_data/loaders";
import { LicensesTable } from "./LicensesTable";

export default async function LicensesPage() {
  const { data: licenses, source } = await getFinanceLicenses();
  const active = licenses.filter((l) => String(l.status).toLowerCase() === "active").length;
  const expired = licenses.filter((l) => String(l.status).toLowerCase() === "expired").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Licenses & Permits"
        subtitle="Issued licenses, permits, and fee tracking."
        back="/finance"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />
      <StatGrid>
        <StatCard icon="📜" iconBg="#e7edfd" label="Total Licenses" value={licenses.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={active} />
        <StatCard icon="⚠️" iconBg="#fffaeb" label="Expired" value={expired} />
        <StatCard icon="📊" iconBg="#eff6ff" label="Types" value={new Set(licenses.map((l) => String(l.type ?? ""))).size} />
      </StatGrid>
      <Card title="Licenses">
        <LicensesTable licenses={licenses} source={source === "error" ? "error" : "api"} />
      </Card>
    </main>
  );
}
