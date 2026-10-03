import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { getSessionRoles, PAYROLL_ADMIN_ROLES, PAYROLL_READER_ROLES } from "@/lib/auth/roleGuard";
import { CreateFlexPlanForm } from "./CreateFlexPlanForm";
import { ElectFlexBenefitForm } from "./ElectFlexBenefitForm";
import { FlexElectionApprovals } from "./FlexElectionApprovals";
import { mapFlexPlans, mapPendingElections, type FlexElectionStatus, type FlexPlan, type PendingFlexElections } from "./flexPlans";
import { toHumanError } from "@/lib/messages";
import { getTranslations } from "next-intl/server";

type ElectionRow = {
  id: string;
  plan_id: string;
  plan_name: string;
  fy: string;
  total_elected_minor: number | string;
  // submitted | approved | rejected; typed loosely so an unexpected API value
  // renders as raw text with a neutral tone instead of crashing.
  status: FlexElectionStatus | (string & {});
} & Record<string, unknown>;

type PlanRow = {
  id: string;
  name: string;
  fy: string;
  total_budget_minor: string;
  components_summary: string;
} & Record<string, unknown>;

/**
 * GAP-PAYROLL-FLEX-BENEFITS-02: who may do what, mirroring payroll-service
 * gap-routes.ts -- plan creation is PAYROLL_ROLES (= PAYROLL_ADMIN_ROLES);
 * electing and reading plans / my-elections is ALL_ROLES (payroll readers +
 * employee). Anyone else (e.g. a manager-only account) gets a 403 from every
 * endpoint on this page.
 */
const FLEX_ELECT_ROLES = [...PAYROLL_READER_ROLES, "employee"];

async function getElections(): Promise<LoaderResult<ElectionRow[]>> {
  return fetchJson<unknown, ElectionRow[]>("/api/v1/payroll/flex-benefits/my-elections", [], {
    telemetryKey: "payroll.flex-benefits.my-elections",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ElectionRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

async function getPlans(): Promise<LoaderResult<FlexPlan[]>> {
  return fetchJson<unknown, FlexPlan[]>("/api/v1/payroll/flex-benefits/plans", [], {
    telemetryKey: "payroll.flex-benefits.plans",
    mapResponse: mapFlexPlans,
  });
}

/**
 * GAP-PAYROLL-FLEX-BENEFITS-05: the approver queue (payroll roles only; the
 * endpoint is PAYROLL_ROLES). Oldest-first would hide new work, so the API
 * returns newest first; the first 50 are shown with a "showing N of M" note.
 */
async function getPendingElections(): Promise<LoaderResult<PendingFlexElections>> {
  return fetchJson<unknown, PendingFlexElections>(
    "/api/v1/payroll/flex-benefits/elections?status=submitted&limit=50",
    { rows: [], total: 0 },
    { telemetryKey: "payroll.flex-benefits.pending-elections", mapResponse: mapPendingElections },
  );
}

export default async function FlexBenefitsPage() {
  const t = await getTranslations("payrollFlexBenefits");
  const roles = getSessionRoles();
  const canManagePlans = roles.some((r) => PAYROLL_ADMIN_ROLES.includes(r));
  const canElect = roles.some((r) => FLEX_ELECT_ROLES.includes(r));

  if (!canElect && !canManagePlans) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr/payroll" backLabel={t("backLabel")} />
        <PermissionDenied module="flex benefits" requiredRoles={FLEX_ELECT_ROLES} backHref="/hr/payroll" backLabel={t("backLabel")} />
      </div>
    );
  }

  const [{ data: elections, source }, { data: plans, source: plansSource }, pending] = await Promise.all([
    getElections(),
    getPlans(),
    canManagePlans ? getPendingElections() : Promise.resolve(null),
  ]);
  const errored = source === "error";

  const columns: { key: keyof ElectionRow & string; label: string; align?: "left" | "right"; cellType?: "status" | "amount" }[] = [
    { key: "plan_name", label: t("colPlan") },
    { key: "fy", label: t("colFinancialYear") },
    { key: "total_elected_minor", label: t("colTotalElected"), align: "right", cellType: "amount" },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  // GAP-PAYROLL-FLEX-BENEFITS-04: the plans the subtitle promises are now
  // actually listed (from GET /flex-benefits/plans).
  const planColumns: { key: keyof PlanRow & string; label: string; align?: "left" | "right"; cellType?: "amount" }[] = [
    { key: "name", label: t("colPlan") },
    { key: "fy", label: t("colFinancialYear") },
    { key: "total_budget_minor", label: t("colBudget"), align: "right", cellType: "amount" },
    { key: "components_summary", label: t("colComponents") },
  ];
  const planRows: PlanRow[] = plans.map((p) => ({
    id: p.id,
    name: p.name,
    fy: p.fy,
    total_budget_minor: p.totalBudgetMinor,
    components_summary: p.components.map((c) => `${c.name} (≤ ${formatMoney(c.maxMinor)})`).join(", "),
  }));

  const totalElectedMinor = elections.reduce((sum, r) => sum + BigInt(String(r.total_elected_minor ?? 0)), 0n);
  const approvedElections = elections.filter((e) => e.status === "approved").length;
  const uniqueFYs = new Set(elections.map((e) => e.fy).filter(Boolean)).size;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll" backLabel={t("backLabel")}
      />
      <DataSourceBadge source={source} message={t("loadErrorMessage")} />
      <StatGrid>
        <StatCard icon="🧩" iconBg="var(--infobg)" label={t("statMyElections")} value={errored ? null : elections.length} />
        <StatCard icon="💰" iconBg="var(--goodbg)" label={t("statTotalElected")} value={errored ? null : formatMoney(totalElectedMinor)} />
        <StatCard icon="✅" iconBg="var(--warnbg)" label={t("statApproved")} value={errored ? null : approvedElections} />
        <StatCard icon="📅" iconBg="var(--goodbg)" label={t("statFinancialYears")} value={errored ? null : uniqueFYs} />
      </StatGrid>

      {canManagePlans && <CreateFlexPlanForm />}
      {canElect && <ElectFlexBenefitForm plans={plans} />}

      <Card title={t("plansCardTitle")}>
        {plansSource === "error" ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "flex benefit plans" })} backHref="/hr/payroll" />
          </div>
        ) : (
          <DataTable<PlanRow>
            columns={planColumns}
            rows={planRows}
            pageSize={10}
            emptyIcon="🧩"
            emptyTitle={t("plansEmptyTitle")}
            emptyMessage={canManagePlans ? t("plansEmptyMessageAdmin") : t("plansEmptyMessageEmployee")}
          />
        )}
      </Card>

      {pending && (
        <Card title={t("pendingCardTitle")}>
          {pending.source === "error" ? (
            <div className="pad">
              <RefreshErrorState error={toHumanError("load", { area: "flex benefit elections awaiting approval" })} backHref="/hr/payroll" />
            </div>
          ) : (
            <FlexElectionApprovals rows={pending.data.rows} total={pending.data.total} />
          )}
        </Card>
      )}

      {canElect && (
        <Card title={t("cardTitle")}>
          {errored ? (
            <div className="pad">
              <RefreshErrorState error={toHumanError("load", { area: "flex benefits" })} backHref="/hr/payroll" />
            </div>
          ) : (
            <DataTable<ElectionRow>
              columns={columns}
              rows={elections}
              sortable
              filterable
              filterPlaceholder={t("filterPlaceholder")}
              pageSize={15}
              emptyIcon="🧩"
              emptyTitle={t("emptyTitle")}
              emptyMessage={t("emptyMessageElect")}
            />
          )}
        </Card>
      )}
    </div>
  );
}
