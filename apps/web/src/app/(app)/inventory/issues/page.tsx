import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getInventoryLedger } from "../_data";
import { MovementsTable } from "../MovementsTable";

export const dynamic = "force-dynamic";

export default async function InventoryIssuesPage() {
  const { data: ledger, source } = await getInventoryLedger();
  const issues = ledger.filter((e) => e.movementType === "issue");
  const totalQty = issues.reduce((s, e) => s + e.qtyOut, 0);

  return (
    <>
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/inventory">Inventory</a>
      </nav>
      <PageHeader title="Stock Issues" subtitle="Stock issued/consumed from stores against indents." />
      {source === "error" && <DataSourceBadge source="error" />}
      <main aria-label="Inventory stock issues">
        <StatGrid>
          <StatCard icon="📤" iconBg="#fee2e2" label="Issue Lines" value={issues.length} />
          <StatCard icon="🔢" iconBg="#f1f5f9" label="Total Qty Issued" value={totalQty} />
        </StatGrid>
        <Card title="Issues">
          <MovementsTable entries={ledger} kind="issue" source={source} />
        </Card>
      </main>
    </>
  );
}
