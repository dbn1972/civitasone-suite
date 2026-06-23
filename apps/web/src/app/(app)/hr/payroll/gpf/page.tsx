import { PageHeader, Card, DataTable } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getGpfStatements } from "../../../../_data/loaders";

function fmt(minor?: number) {
  if (minor == null) return "—";
  return `₹${(minor / 100).toLocaleString("en-IN")}`;
}

export default async function GpfStatementsPage() {
  const { data: rows, source } = await getGpfStatements();

  return (
    <>
      <PageHeader title="GPF Statements" subtitle="General Provident Fund contributions (eHRMS / PFMS)." />
      {source === "error" && <DataSourceBadge source="error" />}
      <Card title="GPF Ledger">
        <DataTable
          columns={[
            { key: "employeeId", label: "Employee" },
            { key: "period", label: "Period" },
            { key: "contrib", label: "Employee GPF (10%)", align: "right" },
          ]}
          rows={rows.map((r) => ({
            id: r.id,
            employeeId: r.employeeId.slice(0, 8) + "…",
            period: r.period,
            contrib: fmt(r.empContribMinor),
          }))}
        />
      </Card>
    </>
  );
}
