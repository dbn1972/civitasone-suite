import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "../../../../_components/ds";
import { getFinanceBudgets } from "../../../../_data/loaders";
import { FormulationTable } from "./FormulationTable";
import { formatMoney } from "@/lib/formatters";

export default async function BudgetFormulationPage() {
  const { data: budgets, source } = await getFinanceBudgets();

  // sanctionedAmount/expenditure are minor-unit (paise) decimal strings —
  // sum as BigInt so formatMoney() gets the right scale and large budgets
  // can't drift under float addition.
  const totalSanctioned = budgets.reduce((s, b) => s + BigInt(b.sanctionedAmount || "0"), 0n);
  const totalExpenditure = budgets.reduce((s, b) => s + BigInt(b.expenditure || "0"), 0n);
  const pending = budgets.filter((b) => b.status === "pending").length;
  const uniqueHeads = new Set(budgets.map((b) => b.majorHead)).size;

  return (
    <>
      <PageHeader
        title="Budget Formulation"
        subtitle="Prepare departmental budget estimates by major/minor head."
        actions={
          <>
            {/* "Circular" used to point at the same href as "+ New Estimate" —
                there is no separate circular/notice feature to link to, so the
                duplicate (misleading) action is removed rather than left as a
                dead second button to the same form. */}
            <a href="/finance/budget/formulation/new" className="btn primary">+ New Estimate</a>
            {source === "error" ? <DataSourceBadge source={source} /> : null}
          </>
        }
      />

      <StatGrid>
        <StatCard icon="📝" iconBg="#e7edfd" label="Budget Heads" value={budgets.length} />
        <StatCard icon="🏢" iconBg="#eff6ff" label="Major Heads" value={uniqueHeads} delta={`submitted ${budgets.filter(b => b.status === "approved").length}`} up={true} />
        <StatCard icon="💰" iconBg="#fffaeb" label="Proposed Outlay" value={formatMoney(totalSanctioned)} up={false} />
        <StatCard icon="⏳" iconBg="#fef3f2" label="Pending Review" value={pending} />
      </StatGrid>

      <Card title="Budget estimates (BE) — all fiscal years">
        <FormulationTable budgets={budgets} source={source} />
      </Card>
    </>
  );
}
