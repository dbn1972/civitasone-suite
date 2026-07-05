import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getFinanceTaxNonTax } from "@/app/_data/loaders";
import { TaxNonTaxTable } from "./TaxNonTaxTable";

export default async function TaxNonTaxPage() {
  const { data: heads, source } = await getFinanceTaxNonTax();
  const taxHeads = heads.filter((h) => String(h.category).toLowerCase() === "tax").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Tax & Non-Tax Revenue" subtitle="Budget vs actual revenue by account head with variance analysis." back="/finance" actions={source === "error" ? <DataSourceBadge source={source} /> : null} />
      <StatGrid>
        <StatCard icon="📊" iconBg="#e7edfd" label="Revenue Heads" value={heads.length} />
        <StatCard icon="🏛️" iconBg="#ecfdf3" label="Tax Heads" value={taxHeads} />
        <StatCard icon="📋" iconBg="#fffaeb" label="Non-Tax Heads" value={heads.length - taxHeads} />
        <StatCard icon="💰" iconBg="#eff6ff" label="FY Collection" value={`${heads.length} heads`} />
      </StatGrid>
      <Card title="Revenue Heads"><TaxNonTaxTable heads={heads} source={source === "error" ? "error" : "api"} /></Card>
    </main>
  );
}
