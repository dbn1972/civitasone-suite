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
  program: string;
  rating: number;
  submittedOn: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/hrms/training/feedback", [], {
    telemetryKey: "hr.training_feedback",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      if (!Array.isArray(arr)) return null;
      return arr.map((f: Record<string, unknown>) => ({ ...f, rating: parseFloat(String(f.rating)) || 0 })) as Row[];
    },
  });
  return r;
}

/**
 * Mirrors training/routes.ts: GET /v1/hrms/training/feedback
 * requires HR_ROLES = ["hr_admin", "hr_officer", "super_admin"].
 */
const TRAINING_ADMIN_ROLES = ["hr_admin", "hr_officer", "super_admin"];

export default async function TrainingFeedbackPage() {
  const t = await getTranslations("trainingFeedback");
  const roles = getSessionRoles();
  const canAccess = roles.some((r: string) => TRAINING_ADMIN_ROLES.includes(r));

  if (!canAccess) {
    return <PermissionDenied module="training feedback" requiredRoles={TRAINING_ADMIN_ROLES} />;
  }

  const { data: items, source } = await getData();

  const columns: { key: keyof Row & string; label: string; render?: (r: Row) => string }[] = [
    { key: "employee", label: t("colEmployee") },
    { key: "program", label: t("colProgram") },
    { key: "rating", label: t("colOverallRating"), render: (r) => r.rating.toFixed(1) },
    { key: "submittedOn", label: t("colSubmitted") },
  ];

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr" backLabel="Back to HR" />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="📋" iconBg="var(--infobg, #e6f0ff)" label={t("statTotal")} value={items.length} />
        <StatCard icon="📚" iconBg="var(--goodbg, #e6f7f0)" label={t("statPrograms")} value={new Set(items.map((i) => i.program)).size} />
        <StatCard icon="👥" iconBg="var(--warnbg, #fffbe6)" label={t("statEmployees")} value={new Set(items.map((i) => i.employee)).size} />
        <StatCard icon="⭐" iconBg="var(--bg, #f5f5f5)" label={t("statAvgRating")} value={items.length > 0 ? (items.reduce((s, i) => s + i.rating, 0) / items.length).toFixed(1) : "—"} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        {source === "error" ? (
          <RefreshErrorState error={toHumanError("load", { area: "training feedback" })} />
        ) : (
          <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder={t("filterPlaceholder")}
            pageSize={15}
            emptyIcon="📝"
            emptyTitle={t("emptyTitle")}
            emptyMessage={t("emptyMessage")}
          />
        )}
      </Card>
    </div>
  );
}
