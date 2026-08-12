import { PageHeader, Card, DataTable, EmptyState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getGpfStatements } from "../../../../_data/loaders";

type GpfRow = {
  id: string;
  employeeId: string;
  employeeCode: string;
  period: string;
  contrib: number | string;
} & Record<string, unknown>;

export default async function GpfStatementsPage() {
  const { data: rows, source } = await getGpfStatements();

  const tableRows: GpfRow[] = rows.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    employeeCode: r.employeeId.slice(0, 8).toUpperCase(),
    period: r.period,
    contrib: r.empContribMinor ?? 0,
  }));

  return (
    <>
      <PageHeader title="GPF Statements" subtitle="General Provident Fund contributions (eHRMS / PFMS)." back="/hr/payroll" />
      <DataSourceBadge source={source} />
      <Card title="GPF Ledger">
        {tableRows.length === 0 ? (
          <EmptyState
            icon="🏦"
            title="No GPF statements"
            message="No General Provident Fund contributions have been recorded yet."
          />
        ) : (
          <DataTable<GpfRow>
            columns={[
              { key: "employeeCode", label: "Employee" },
              { key: "period", label: "Period" },
              { key: "contrib", label: "Employee GPF (10%)", align: "right", cellType: "amount" },
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
