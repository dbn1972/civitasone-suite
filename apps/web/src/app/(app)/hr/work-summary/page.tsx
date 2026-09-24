import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../../_components/PermissionDenied";
import { toHumanError } from "@/lib/messages";
import { getTranslations } from "next-intl/server";

const WORK_SUMMARY_ROLES = ["hr_admin", "hr_officer", "manager", "super_admin"];

type ApiRow = {
  id: string;
  employee?: string;
  employeeName?: string;
  department?: string;
  period?: string;
  periodType?: string;
  tasksCompleted?: number;
  totalTasks?: number;
  rating?: number | string;
  status: string;
};

type Row = {
  id: string;
  employee: string;
  department: string;
  period: string;
  periodType: string;
  tasks: string;
  rating: string;
  status: string;
} & Record<string, unknown>;

function mapRows(apiItems: ApiRow[]): Row[] {
  return apiItems.map((s) => ({
    id: s.id,
    employee: s.employee ?? s.employeeName ?? "—",
    department: s.department ?? "—",
    period: s.period ?? "—",
    periodType: s.periodType ?? "—",
    tasks: s.tasksCompleted != null && s.totalTasks != null
      ? `${s.tasksCompleted} / ${s.totalTasks}`
      : "—",
    rating: s.rating != null ? `${Number(s.rating).toFixed(1)} / 5` : "—",
    status: s.status,
  }));
}

async function getData(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/hrms/work-summaries", [], {
    telemetryKey: "hr.work-summaries",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiRow[] })?.data;
      return Array.isArray(arr) ? mapRows(arr as ApiRow[]) : null;
    },
  });
}

export default async function WorkSummaryPage() {
  const t = await getTranslations("workSummary");
  /* ── Role gate ─────────────────────────────────────────────── */
  const roles = getSessionRoles();
  const canAccess = roles.some((r) => WORK_SUMMARY_ROLES.includes(r));
  if (!canAccess) {
    return <PermissionDenied module="work summaries" requiredRoles={WORK_SUMMARY_ROLES} />;
  }

  const { data: items, source } = await getData();
  const errored = source === "error";

  const reviewed = items.filter((i) => ["approved", "accepted", "finalised"].includes(i.status)).length;
  const pending = items.filter((i) => ["pending", "submitted"].includes(i.status)).length;
  const employees = new Set(items.map((i) => i.employee).filter((e) => e !== "—")).size;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employee", label: t("colEmployee") },
    { key: "department", label: t("colDepartment") },
    { key: "period", label: t("colPeriod") },
    { key: "periodType", label: t("colType") },
    { key: "tasks", label: t("colTasks") },
    { key: "rating", label: t("colRating") },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
        actions={<span />}
      />
      <DataSourceBadge source={source} />
      <StatGrid>
<StatCard icon="📝" iconBg="var(--infobg, #e6f0ff)" label={t("statTotal")} value={errored ? null : items.length} />
        <StatCard icon="👤" iconBg="var(--bg, #f5f5f5)" label={t("statEmployees")} value={errored ? null : employees} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statReviewed")} value={errored ? null : reviewed} />
        <StatCard icon="⏳" iconBg="var(--warnbg, #fffbe6)" label={t("statPending")} value={errored ? null : pending} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "work summary" })} backHref="/hr" />
          </div>
        ) : (
          <DataTable<Row>
          columns={columns}
          rows={items}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
          emptyIcon="📝"
          emptyTitle={t("emptyTitle")}
          emptyMessage={t("emptyMessage")}
        />
        )}
      </Card>
    </main>
  );
}
