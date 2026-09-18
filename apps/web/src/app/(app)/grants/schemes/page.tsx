import Link from "next/link";
import { PageHeader, Card, StatGrid, StatCard } from "@/app/_components/ds";
import { formatMoney } from "@/lib/formatters";
import { getGrantSchemes } from "../_data";
import { SchemesTable } from "./SchemesTable";
import { ArrowLeft } from "lucide-react";

export default async function GrantSchemesPage() {
  const { data: schemes, source } = await getGrantSchemes();

  const open = schemes.filter((s) => s.status === "open").length;
  const totalBudget = schemes.reduce((sum, s) => sum + s.budgetMinor, 0);
  const totalDisbursed = schemes.reduce((sum, s) => sum + s.disbursedMinor, 0);
  const totalApplications = schemes.reduce((sum, s) => sum + s.applicationCount, 0);

  return (
    <>
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/grants">Grants</a>
      </nav>
      <PageHeader
        title="Grant Schemes"
        subtitle="Browse and manage government grant schemes."
        back="/grants"
        backLabel="Grants"
        help="grants"
        actions={
          <Link href="/grants/schemes/new" className="btn primary">
            + New Scheme
          </Link>
        }
      />
      {/* UX-012: the data-source badge now lives inside SchemesTable, driven
          by the same useSeededResource call that produces its rows — not a
          second, independent read of `source` here that could disagree with
          the table's own cache state (UX-002's pattern). */}
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
