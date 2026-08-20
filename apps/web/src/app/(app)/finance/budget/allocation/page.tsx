import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getFinanceAllocations } from "@/app/_data/loaders";
import { AllocationTable } from "./AllocationTable";

export default async function AllocationPage() {
  const { data: allocations, source } = await getFinanceAllocations();
  // FinanceBudgetAllocationSummary has no "released" field — committedMinor
  // (funds committed for spending) is the real, distinct GFR stage this
  // counts. Labelled "Committed" below rather than "Released" so the card
  // doesn't imply funds have been physically disbursed downstream.
  const committed = allocations.filter((a) => Number(a.committedMinor ?? 0) > 0).length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Budget Allocation"
        subtitle="Department-wise allocation, release, and utilization."
        back="/finance"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />
      <StatGrid>
        <StatCard icon="📊" iconBg="#e7edfd" label="Allocations" value={allocations.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Committed" value={committed} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending" value={allocations.length - committed} />
        <StatCard icon="🏛️" iconBg="#eff6ff" label="Budget Heads" value={new Set(allocations.map((a) => a.headId)).size} />
      </StatGrid>
      <Card title="Budget Allocations">
        <AllocationTable allocations={allocations} source={source === "error" ? "error" : "api"} />
      </Card>
    </main>
  );
}
