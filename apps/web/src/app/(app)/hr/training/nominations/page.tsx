import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { getTranslations } from "next-intl/server";

type Row = {
  id: string;
  employee: string;
  department: string;
  program: string;
  nominatedBy: string;
  nominationDate: string;
  programDate: string;
  status: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/hrms/training/nominations", [], {
    telemetryKey: "hr.training_nominations",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return r;
}

/**
 * Mirrors training/routes.ts: GET /v1/hrms/training/nominations
 * requires HR_ROLES = ["hr_admin", "hr_officer", "super_admin"].
 */
const TRAINING_ADMIN_ROLES = ["hr_admin", "hr_officer", "super_admin"];

export default async function TrainingNominationsPage() {
  const t = await getTranslations("trainingNominations");
  const roles = getSessionRoles();
  const canAccess = roles.some((r: string) => TRAINING_ADMIN_ROLES.includes(r));

  if (!canAccess) {
    return <PermissionDenied module="training nominations" requiredRoles={TRAINING_ADMIN_ROLES} />;
  }

  const { data: items, source } = await getData();

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employee", label: t("colEmployee") },
    { key: "department", label: t("colDepartment") },
    { key: "program", label: t("colProgram") },
    { key: "nominatedBy", label: t("colNominatedBy") },
    { key: "programDate", label: t("colProgramDate") },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr" backLabel="Back to HR" />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="📋" iconBg="var(--infobg, #e6f0ff)" label={t("statTotal")} value={items.length} />
        <StatCard icon="⏳" iconBg="var(--warnbg, #fffbe6)" label={t("statPending")} value={items.filter((i) => i.status === "pending").length} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statApproved")} value={items.filter((i) => i.status === "approved").length} />
        <StatCard icon="📚" iconBg="var(--bg, #f5f5f5)" label={t("statPrograms")} value={new Set(items.map((i) => i.program)).size} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        {source === "error" ? (
          <RefreshErrorState error={toHumanError("load", { area: "training nominations" })} />
        ) : (
          <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder={t("filterPlaceholder")}
            pageSize={15}
            emptyIcon="🎓"
            emptyTitle={t("emptyTitle")}
            emptyMessage={t("emptyMessage")}
          />
        )}
      </Card>
    </div>
  );
}
