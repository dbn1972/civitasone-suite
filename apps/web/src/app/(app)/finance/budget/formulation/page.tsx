import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "../../../../_components/ds";
import { getFinanceBudgets } from "../../../../_data/loaders";
import { FormulationTable } from "./FormulationTable";
import { formatMoney } from "@/lib/formatters";

export default async function BudgetFormulationPage() {
  const { data: budgets, source } = await getFinanceBudgets();

  const totalSanctioned = budgets.reduce((s, b) => s + b.sanctionedAmount, 0);
  const totalExpenditure = budgets.reduce((s, b) => s + b.expenditure, 0);
  const pending = budgets.filter((b) => b.status === "pending").length;
  const uniqueHeads = new Set(budgets.map((b) => b.majorHead)).size;

  return (
    <>
      <PageHeader
        title="Budget Formulation"
        subtitle="Prepare departmental budget estimates by major/minor head."
        actions={
          <>
            <button className="btn ghost">Circular</button>
            <button className="btn primary">+ New Estimate</button>
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

      <Card title="Budget estimates (BE) · FY 2026-27">
        <FormulationTable budgets={budgets} source={source} />
      </Card>
    </>
  );
}
