import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { CreateStructureForm } from "./CreateStructureForm";

type Row = {
  id: string;
  name: string;
  isDefault: boolean;
  status: string;
} & Record<string, unknown>;

type ComponentRow = {
  id: string;
  code: string;
  name: string;
  componentType: string;
  isTaxable: boolean;
  structureId: string | null;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/payroll/structures", [], {
    telemetryKey: "payroll.structures",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

async function getComponents(): Promise<LoaderResult<ComponentRow[]>> {
  return fetchJson<unknown, ComponentRow[]>("/api/v1/payroll/components", [], {
    telemetryKey: "payroll.components",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ComponentRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function PayStructuresPage() {
  const [{ data: structures, source: structuresSource }, { data: rawComponents, source: componentsSource }] = await Promise.all([
    getData(),
    getComponents(),
  ]);
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

  const componentRows: (ComponentRow & { taxableLabel: string })[] = rawComponents.map((c) => ({
    ...c,
    taxableLabel: c.isTaxable ? "Yes" : "No",
  }));

  const componentColumns: { key: keyof ComponentRow | "taxableLabel"; label: string; cellType?: "status" }[] = [
    { key: "code", label: "Code" },
    { key: "name", label: "Component Name" },
    { key: "componentType", label: "Type", cellType: "status" },
    { key: "taxableLabel", label: "Taxable" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Pay Structures"
        subtitle="Define earning and deduction components that make up an employee's pay."
        back="/hr/payroll"
      />
      {(structuresSource === "error" || componentsSource === "error") && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="🧱" iconBg="#e6f0ff" label="Total Structures" value={structures.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Active" value={active} />
        <StatCard icon="⭐" iconBg="#fffbe6" label="Default" value={defaultCount} />
        <StatCard icon="🧩" iconBg="#f5f5f5" label="Components" value={rawComponents.length} />
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
        <DataTable<ComponentRow & { taxableLabel: string }>
          columns={componentColumns}
          rows={componentRows}
          sortable
          filterable
          filterPlaceholder="Filter by name or code…"
          pageSize={20}
          emptyIcon="🧩"
          emptyTitle="No components yet"
          emptyMessage="Components are added when a payroll structure is created with earnings and deductions."
        />
      </Card>
    </main>
  );
}
