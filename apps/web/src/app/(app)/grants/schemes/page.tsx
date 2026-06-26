import Link from "next/link";
import { PageHeader, Card, StatGrid, StatCard } from "@/app/_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { formatMoney } from "@/lib/formatters";
import { getGrantSchemes } from "../_data";
import { SchemesTable } from "./SchemesTable";

export default async function GrantSchemesPage() {
  const { data: schemes, source } = await getGrantSchemes();

  const open = schemes.filter((s) => s.status === "open").length;
  const totalBudget = schemes.reduce((sum, s) => sum + s.budgetMinor, 0);
  const totalDisbursed = schemes.reduce((sum, s) => sum + s.disbursedMinor, 0);
  const totalApplications = schemes.reduce((sum, s) => sum + s.applicationCount, 0);

  return (
    <>
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/grants">Grants</a>
      </nav>
      <PageHeader
        title="Grant Schemes"
        subtitle="Browse and manage government grant schemes."
        back="/grants"
        backLabel="Grants"
        actions={
          <Link href="/grants/schemes/new" className="btn primary">
            + New Scheme
          </Link>
        }
      />
      {source === "error" && <DataSourceBadge source="error" />}
      <main aria-label="Grant schemes">
        <StatGrid>
          <StatCard icon="📋" iconBg="#f1f5f9" label="Total Schemes" value={schemes.length} />
          <StatCard icon="✅" iconBg="#dcfce7" label="Open" value={open} />
          <StatCard
            icon="💰"
            iconBg="#dbeafe"
            label="Total Budget"
            value={formatMoney(totalBudget)}
          />
          <StatCard
            icon="📤"
            iconBg="#fef3c7"
            label="Applications"
            value={totalApplications}
          />
        </StatGrid>
        <Card title="Schemes">
          <SchemesTable schemes={schemes} source={source} />
        </Card>
      </main>
    </>
  );
}
