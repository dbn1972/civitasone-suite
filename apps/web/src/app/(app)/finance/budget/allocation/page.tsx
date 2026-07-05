import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getFinanceAllocations } from "@/app/_data/loaders";
import { AllocationTable } from "./AllocationTable";

export default async function AllocationPage() {
  const { data: allocations, source } = await getFinanceAllocations();
  const released = allocations.filter((a) => Number(a.releasedMinor ?? 0) > 0).length;

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
        <StatCard icon="✅" iconBg="#ecfdf3" label="Released" value={released} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending" value={allocations.length - released} />
        <StatCard icon="🏛️" iconBg="#eff6ff" label="Departments" value={new Set(allocations.map((a) => String(a.department ?? ""))).size} />
      </StatGrid>
      <Card title="Budget Allocations">
        <AllocationTable allocations={allocations} source={source === "error" ? "error" : "api"} />
      </Card>
    </main>
  );
}
