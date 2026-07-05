import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getFinanceDeductions } from "@/app/_data/loaders";
import { DeductionsTable } from "./DeductionsTable";

export default async function DeductionsPage() {
  const { data: deductions, source } = await getFinanceDeductions();
  const tdsCount = deductions.filter((d) => Number(d.tdsMinor ?? 0) > 0).length;
  const gstCount = deductions.filter((d) => Number(d.gstMinor ?? 0) > 0).length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Deduction Register"
        subtitle="Statutory deductions (TDS, IT, GST) applied on vendor bills before payment."
        back="/finance"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />
      <StatGrid>
        <StatCard icon="🧮" iconBg="#e7edfd" label="Bills with Deductions" value={deductions.length} />
        <StatCard icon="📋" iconBg="#ecfdf3" label="TDS Applied" value={tdsCount} />
        <StatCard icon="💰" iconBg="#fffaeb" label="GST Withheld" value={gstCount} />
        <StatCard icon="📊" iconBg="#eff6ff" label="Vendors" value={new Set(deductions.map((d) => String(d.vendor ?? ""))).size} />
      </StatGrid>
      <Card title="Deduction Register">
        <DeductionsTable deductions={deductions} source={source === "error" ? "error" : "api"} />
      </Card>
    </main>
  );
}
