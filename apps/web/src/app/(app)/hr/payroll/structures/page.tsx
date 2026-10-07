import { PageHeader, StatGrid, StatCard, Card, EmptyState, RefreshErrorState } from "../../../../_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { CreateStructureForm } from "./CreateStructureForm";
import { SalaryStructureCard } from "./SalaryStructureCard";
import { ComponentGrid } from "./ComponentGrid";
import { toHumanError } from "@/lib/messages";
import { getTranslations } from "next-intl/server";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { getSessionRoles } from "@/lib/auth/roleGuard";

// GAP-HR-SALARY-STRUCTURE-05: this page rendered the full pay-structure
// list, the per-structure component composition, the full component
// catalog, AND the create-structure form for ANY authenticated session --
// no gate at all (the sibling /hr/salary-structure page being redirected
// here, GAP-HR-SALARY-STRUCTURE-02, had the identical gap). Matches the
// backend's own READER_ROLES for GET /v1/payroll/structures and
// GET /v1/payroll/components (payroll-service payroll/routes.ts), which
// already 403 everyone outside this list -- same convention as
// payroll/pensioners/page.tsx's PENSIONER_VIEW_ROLES and
// payroll/salary-slips/page.tsx's SALARY_ADMIN_ROLES.
const STRUCTURES_VIEW_ROLES = ["payroll_admin", "payroll_officer", "super_admin", "hr_admin", "finance_officer"];

// Matches the backend's PAYROLL_ROLES for POST /v1/payroll/structures
// (payroll-service payroll/routes.ts) -- a strict subset of
// STRUCTURES_VIEW_ROLES above. Without this, an hr_admin/finance_officer
// viewer (who can VIEW structures but not create one, per the backend)
// would see a "Create Structure" form that always 403s on submit -- same
// bug class already found and fixed on payroll/pensioners/page.tsx
// (PENSIONER_CREATE_ROLES vs PENSIONER_VIEW_ROLES).
const STRUCTURES_CREATE_ROLES = ["payroll_admin", "payroll_officer", "super_admin"];

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
  formula?: string | null;
  pctOfBasic?: string | number | null;
  fixedMinor?: string | null;
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
  const roles = getSessionRoles();
  if (!roles.some((r) => STRUCTURES_VIEW_ROLES.includes(r))) {
    return <PermissionDenied module="pay structures" requiredRoles={STRUCTURES_VIEW_ROLES} />;
  }
  const canCreate = roles.some((r) => STRUCTURES_CREATE_ROLES.includes(r));

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
    <div className="page-main wrap">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll" backLabel="Back to Payroll"
      />
      {/* GAP-PAYROLL-STRUCTURES-05: structures and components are
          independent fetches with no visible error source at all before --
          the stat tiles alone (dashes on error) don't say WHAT failed or
          that a retry might help. */}
      <DataSourceBadge
        source={structuresErrored || componentsErrored ? "error" : "api"}
        message={t("loadErrorMessage")}
      />
      <StatGrid>
        <StatCard icon="🧱" iconBg="var(--infobg)" label={t("statTotal")} value={structuresErrored ? "—" : structures.length} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label={t("statActive")} value={active ?? "—"} />
        <StatCard icon="⭐" iconBg="var(--warnbg)" label={t("statDefault")} value={defaultCount ?? "—"} />
        <StatCard icon="🧩" iconBg="var(--panel)" label={t("statComponents")} value={componentsErrored ? "—" : rawComponents.length} />
      </StatGrid>

      {canCreate && <CreateStructureForm />}

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
                componentsUnavailable={componentsErrored}
              />
            ))}
          </div>
        </Card>
      )}

      <Card title={t("componentGridTitle")}>
        {componentsErrored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: t("componentsArea") })} backHref="/hr/payroll" />
          </div>
        ) : (
          <ComponentGrid
            components={rawComponents.map((c) => ({
              id: c.id,
              code: c.code,
              name: c.name,
              componentType: c.componentType,
              isTaxable: c.isTaxable,
              structureId: c.structureId,
              formula: c.formula ?? null,
              pctOfBasic: c.pctOfBasic ?? null,
              fixedMinor: c.fixedMinor ?? null,
            }))}
          />
        )}
      </Card>
    </div>
  );
}
