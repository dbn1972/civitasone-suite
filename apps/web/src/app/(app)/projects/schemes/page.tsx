import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getSchemes } from "../../../_data/loaders";
import { PageHeader, StatGrid, StatCard, Card, EmptyState } from "@/app/_components/ds";
import { formatMoney } from "@/lib/formatters";
import { SchemesTable, type SchemeRow } from "./SchemesTable";

export default async function SchemesPage() {
  const { data: schemes, source } = await getSchemes();

  const active = schemes.filter((s) => s.status === "active").length;
  const totalAllocation = schemes.reduce((sum, s) => sum + s.totalAllocation, 0);
  const totalReleased = schemes.reduce((sum, s) => sum + s.releasedAmount, 0);

  const rows: SchemeRow[] = schemes.map((s) => ({ ...s }));

  return (
    <>
      <PageHeader
        title="Schemes"
        subtitle="Physical & financial progress, beneficiaries — scheme-wise."
      />
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="📋" iconBg="#eef0fe" label="Total" value={schemes.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={active} />
        <StatCard icon="💰" iconBg="#eff6ff" label="Total Allocation" value={formatMoney(totalAllocation)} />
        <StatCard icon="📤" iconBg="#fffaeb" label="Released" value={formatMoney(totalReleased)} />
      </StatGrid>
      <Card title="Schemes">
        {rows.length === 0 ? (
          <EmptyState icon="🏛️" title="No schemes" message="No schemes have been configured yet." />
        ) : (
          <SchemesTable rows={rows} />
        )}
      </Card>
    </>
  );
}
