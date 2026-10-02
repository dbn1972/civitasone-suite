import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "@/app/_components/ds";
import { getFinanceAllocations } from "@/app/_data/loaders";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { AllocationTable } from "./AllocationTable";

export default async function AllocationPage() {
  const result = await getFinanceAllocations();
  const { data: allocations } = result;
  // GAP-FINANCE-BUDGET-ALLOCATION-02: a failed fetch used to render four real
  // zeros and "No budget allocation records found." Errored -> every card
  // shows "—" and the table is replaced by a Retry state; a genuinely empty
  // (successful) list still shows 0s and the empty-state copy.
  const errored = toResourceState(result).status === "error";
  // FinanceBudgetAllocationSummary has no "released" field — committedMinor
  // (funds committed for spending) is the real, distinct GFR stage this
  // counts. Labelled "Committed" below rather than "Released" so the card
  // doesn't imply funds have been physically disbursed downstream.
  const committed = allocations.filter((a) => BigInt(a.committedMinor || "0") > 0n).length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Budget Allocation"
        subtitle="Allocation, commitment and expenditure by budget head and financial year."
        back="/finance"
      />
      <StatGrid>
        <StatCard icon="📊" iconBg="#e7edfd" label="Allocations" value={errored ? "—" : allocations.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Committed" value={errored ? "—" : committed} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Not yet committed" value={errored ? "—" : allocations.length - committed} />
        <StatCard icon="🏛️" iconBg="#eff6ff" label="Budget Heads" value={errored ? "—" : new Set(allocations.map((a) => a.headId)).size} />
      </StatGrid>
      {/* UX-012: the data-source badge lives inside AllocationTable, driven by
          the same useSeededResource call that produces its rows. */}
      <Card title="Budget Allocations">
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "budget allocations" })} backHref="/finance" />
          </div>
        ) : (
          <AllocationTable allocations={allocations} source="api" />
        )}
      </Card>
    </div>
  );
}
