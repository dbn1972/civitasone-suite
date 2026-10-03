import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "@/app/_components/ds";
import { getFinanceAllocations, getFinanceBudgetsForReappropriation } from "@/app/_data/loaders";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { AllocationTable } from "./AllocationTable";
import { ReappropriateWithApproval } from "./ReappropriateWithApproval";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { canWrite, REAPPROPRIATION_SUBMIT_ROLES } from "@/lib/finance/writeRoles";
import { reappropriationOptionsFrom } from "@/lib/finance/reappropriation";

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
  // GAP-FINANCE-BUDGET-ALLOCATION-03: raising a re-appropriation (eOffice approval) is offered to the roles
  // finance-service admits on submit-approval. The from / to budgets are the finance budgets (BE/RE rows), not
  // these allocation rows, so they are loaded separately; if that load fails the control says so instead of
  // offering an empty picker.
  const canReappropriate = !errored && canWrite(getSessionRoles(), REAPPROPRIATION_SUBMIT_ROLES);
  const budgetsResult = canReappropriate ? await getFinanceBudgetsForReappropriation() : null;
  const reappropriationOptions = reappropriationOptionsFrom(budgetsResult?.data ?? []);
  const committed = allocations.filter((a) => BigInt(a.committedMinor || "0") > 0n).length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Budget Allocation"
        subtitle="Allocation, commitment and expenditure by budget head and financial year."
        back="/finance"
      />
      {canReappropriate ? (
        <div style={{ marginBottom: 16 }}>
          {budgetsResult?.source === "error" ? (
            <p role="note" style={{ fontSize: 13, color: "var(--mut)" }}>The budget list could not be loaded, so a re-appropriation cannot be raised right now. Refresh the page to try again.</p>
          ) : (
            <ReappropriateWithApproval allocations={reappropriationOptions} />
          )}
        </div>
      ) : null}
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
