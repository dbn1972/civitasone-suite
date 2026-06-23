import { PageHeader, Card, DataTable } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getNpsStatements } from "../../../../_data/loaders";

function fmt(minor?: number) {
  if (minor == null) return "—";
  return `₹${(minor / 100).toLocaleString("en-IN")}`;
}

export default async function NpsStatementsPage() {
  const { data: rows, source } = await getNpsStatements();

  return (
    <>
      <PageHeader title="NPS Statements" subtitle="National Pension System contributions — 10% employee + 14% employer." />
      {source === "error" && <DataSourceBadge source="error" />}
      <Card title="NPS Ledger">
        <DataTable
          columns={[
            { key: "employeeId", label: "Employee" },
            { key: "period", label: "Period" },
            { key: "emp", label: "Employee (10%)", align: "right" },
            { key: "er", label: "Employer (14%)", align: "right" },
          ]}
          rows={rows.map((r) => ({
            id: r.id,
            employeeId: r.employeeId.slice(0, 8) + "…",
            period: r.period,
            emp: fmt(r.empContribMinor),
            er: fmt(r.erContribMinor),
          }))}
        />
      </Card>
    </>
  );
}
