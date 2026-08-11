import { PageHeader, Card, DataTable, EmptyState } from "../../../../_components/ds";
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

  return (
    <>
      <PageHeader title="NPS Statements" subtitle="National Pension System contributions — 10% employee + 14% employer." back="/hr/payroll" />
      {source === "error" && <DataSourceBadge source="error" />}
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
          />
        )}
      </Card>
    </>
  );
}
