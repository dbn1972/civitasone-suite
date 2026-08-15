import { PageHeader, StatGrid, StatCard, Card, EmptyState } from "../../../../_components/ds";
import { SkeletonTable } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { CreateStructureForm } from "./CreateStructureForm";
import { SalaryStructureCard } from "./SalaryStructureCard";
import { ComponentGrid } from "./ComponentGrid";

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
  const [{ data: structures, source: structuresSource }, { data: rawComponents, source: componentsSource }] =
    await Promise.all([getData(), getComponents()]);

  const active = structures.filter((s) => s.status === "active").length;
  const defaultCount = structures.filter((s) => s.isDefault).length;

  const componentsByStructure = rawComponents.reduce<Record<string, ComponentRow[]>>((acc, c) => {
    const key = c.structureId ?? "__unassigned__";
    if (!acc[key]) acc[key] = [];
    acc[key].push(c);
    return acc;
  }, {});

  const hasError = structuresSource === "error" || componentsSource === "error";

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Pay Structures"
        subtitle="Define earning and deduction components that make up an employee's pay."
        back="/hr/payroll"
      />
      {hasError && <DataSourceBadge source="error" />}

      <StatGrid>
        <StatCard icon="🧱" iconBg="var(--infobg)" label="Total Structures" value={structures.length} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label="Active" value={active} />
        <StatCard icon="⭐" iconBg="var(--warnbg)" label="Default" value={defaultCount} />
        <StatCard icon="🧩" iconBg="var(--panel)" label="Components" value={rawComponents.length} />
      </StatGrid>

      <CreateStructureForm />

      {structures.length === 0 ? (
        <Card title="Pay Structures">
          <EmptyState
            icon="🧱"
            title="No pay structures yet"
            message="Create your first salary structure using the form above."
          />
        </Card>
      ) : (
        <Card title="Salary Structure Cards">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
              gap: 16,
            }}
          >
            {structures.map((s) => (
              <SalaryStructureCard
                key={s.id}
                id={s.id}
                name={s.name}
                isDefault={s.isDefault}
                status={s.status}
                components={componentsByStructure[s.id] ?? []}
              />
            ))}
          </div>
        </Card>
      )}

      <Card title="Component Grid — Earnings, Deductions & Benefits">
        <ComponentGrid
          components={rawComponents.map((c) => ({
            id: c.id,
            code: c.code,
            name: c.name,
            componentType: c.componentType,
            isTaxable: c.isTaxable,
            structureId: c.structureId,
          }))}
        />
      </Card>
    </main>
  );
}
