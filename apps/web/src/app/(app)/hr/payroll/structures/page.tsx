import { PageHeader, StatGrid, StatCard, Card, EmptyState, RefreshErrorState } from "../../../../_components/ds";
import { SkeletonTable } from "../../../../_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { CreateStructureForm } from "./CreateStructureForm";
import { SalaryStructureCard } from "./SalaryStructureCard";
import { ComponentGrid } from "./ComponentGrid";
import { toHumanError } from "@/lib/messages";
import { getTranslations } from "next-intl/server";

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
  const t = await getTranslations("payrollStructures");
  const [structuresResult, componentsResult] = await Promise.all([getData(), getComponents()]);
  const { data: structures, source: structuresSource } = structuresResult;
  const { data: rawComponents, source: componentsSource } = componentsResult;

  // Independent loaders, independently gated: a components-endpoint outage
  // must not blank out the structures list (and vice versa).
  const structuresErrored = structuresSource === "error";
  const componentsErrored = componentsSource === "error";

  const active = structuresErrored ? null : structures.filter((s) => s.status === "active").length;
  const defaultCount = structuresErrored ? null : structures.filter((s) => s.isDefault).length;

  const componentsByStructure = rawComponents.reduce<Record<string, ComponentRow[]>>((acc, c) => {
    const key = c.structureId ?? "__unassigned__";
    if (!acc[key]) acc[key] = [];
    acc[key].push(c);
    return acc;
  }, {});

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll" backLabel="Back to Payroll"
      />
      <StatGrid>
        <StatCard icon="🧱" iconBg="var(--infobg)" label={t("statTotal")} value={structuresErrored ? "—" : structures.length} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label={t("statActive")} value={active ?? "—"} />
        <StatCard icon="⭐" iconBg="var(--warnbg)" label={t("statDefault")} value={defaultCount ?? "—"} />
        <StatCard icon="🧩" iconBg="var(--panel)" label={t("statComponents")} value={componentsErrored ? "—" : rawComponents.length} />
      </StatGrid>

      <CreateStructureForm />

      {structuresErrored ? (
        <Card title={t("structuresCardTitle")}>
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "pay structures" })} backHref="/hr/payroll" />
          </div>
        </Card>
      ) : structures.length === 0 ? (
        <Card title={t("structuresCardTitle")}>
          <EmptyState
            icon="🧱"
            title={t("emptyTitle")}
            message={t("emptyMessage")}
          />
        </Card>
      ) : (
        <Card title={t("cardsTitle")}>
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

      <Card title={t("componentGridTitle")}>
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
    </div>
  );
}
