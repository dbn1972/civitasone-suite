import { PageHeader, Card, DataTable, EmptyState, StatGrid, StatCard } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getNpsStatements } from "../../../../_data/loaders";

type NpsRow = {
  id: string;
  employeeId: string;
  employeeCode: string;
  period: string;
  emp: number;
  er: number;
} & Record<string, unknown>;

export default async function NpsStatementsPage() {
  const { data: rows, source } = await getNpsStatements();

  const tableRows: NpsRow[] = rows.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    employeeCode: r.employeeId.slice(0, 8).toUpperCase(),
    period: r.period,
    emp: r.empContribMinor ?? 0,
    er: r.erContribMinor ?? 0,
  }));

  const uniqueEmps    = new Set(tableRows.map((r) => r.employeeId)).size;
  const uniquePeriods = new Set(tableRows.map((r) => r.period)).size;
  const totalEmp      = tableRows.reduce((s, r) => s + (Number(r.emp) || 0), 0);
  const totalEr       = tableRows.reduce((s, r) => s + (Number(r.er)  || 0), 0);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="NPS Statements" subtitle="National Pension System contributions — 10% employee + 14% employer." back="/hr/payroll" />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="📋" iconBg="var(--infobg)" label="Statements"   value={tableRows.length} />
        <StatCard icon="👥" iconBg="var(--goodbg)" label="Employees"    value={uniqueEmps} />
        <StatCard icon="🧑" iconBg="var(--warnbg)" label="Emp (10%)"    value={`₹${(totalEmp / 100).toLocaleString("en-IN")}`} />
        <StatCard icon="🏛️" iconBg="var(--panel)" label="Employer (14%)" value={`₹${(totalEr / 100).toLocaleString("en-IN")}`} />
      </StatGrid>
      <Card title="NPS Ledger">
        {tableRows.length === 0 ? (
          <EmptyState
            icon="🏦"
            title="No NPS statements"
            message="No National Pension System contributions have been recorded yet."
          />
        ) : (
          <DataTable<NpsRow>
            columns={[
              { key: "employeeCode", label: "Employee" },
              { key: "period", label: "Period" },
              { key: "emp", label: "Employee (10%)", align: "right", cellType: "amount" },
              { key: "er", label: "Employer (14%)", align: "right", cellType: "amount" },
            ]}
            rows={tableRows}
            rowLinkKey="employeeId"
            rowLinkPrefix="/hr/employees/"
            sortable
            filterable
            filterPlaceholder="Filter by employee or period…"
            pageSize={20}
            emptyIcon="🏦"
            emptyTitle="No NPS statements found"
            emptyMessage="No National Pension System records match your filter."
          />
        )}
      </Card>
    </main>
  );
}
