import { PageHeader, StatGrid, StatCard, Card, DataTable, EmptyState } from "../../../../_components/ds";
import { fetchJson } from "@/app/_data/apiClient";
import { CreateStructureForm } from "./CreateStructureForm";

type Row = {
  id: string;
  name: string;
  isDefault: boolean;
  status: string;
} & Record<string, unknown>;

async function getData(): Promise<Row[]> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/payroll/structures", [], {
    telemetryKey: "payroll.structures",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return r.data;
}

export default async function PayStructuresPage() {
  const structures = await getData();
  const active = structures.filter((s) => s.status === "active").length;
  const defaultCount = structures.filter((s) => s.isDefault).length;

  const rows: (Row & { defaultLabel: string })[] = structures.map((s) => ({
    ...s,
    defaultLabel: s.isDefault ? "Yes" : "No",
  }));

  const columns: { key: (keyof Row & string) | "defaultLabel"; label: string; align?: "left" | "right"; cellType?: "status" }[] = [
    { key: "name", label: "Structure Name" },
    { key: "defaultLabel", label: "Default" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Pay Structures"
        subtitle="Define earning and deduction components that make up an employee's pay."
        back="/hr/payroll"
      />
      <StatGrid>
        <StatCard icon="🧱" iconBg="#e6f0ff" label="Total Structures" value={structures.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Active" value={active} />
        <StatCard icon="⭐" iconBg="#fffbe6" label="Default" value={defaultCount} />
      </StatGrid>

      <CreateStructureForm />

      <Card title="Pay Structures">
        <DataTable<Row & { defaultLabel: string }>
          columns={columns}
          rows={rows}
          sortable
          filterable
          filterPlaceholder="Filter by name…"
          pageSize={15}
          emptyIcon="🧱"
          emptyTitle="No pay structures yet"
          emptyMessage="Create your first pay structure using the form above."
        />
      </Card>

      <Card title="Components (earnings & deductions)">
        <EmptyState
          icon="🧩"
          title="Component builder not yet available"
          message="The payroll-service does not currently expose an API to create or list payroll_components for a structure (POST/GET routes are not implemented on the backend). This screen will light up once that endpoint ships — no component data is fabricated here."
        />
      </Card>
    </main>
  );
}
