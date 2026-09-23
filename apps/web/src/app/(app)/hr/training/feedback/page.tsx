import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../../../_components/PermissionDenied";

type Row = {
  id: string;
  employee: string;
  program: string;
  rating: string;
  submittedOn: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/hrms/training/feedback", [], {
    telemetryKey: "hr.training_feedback",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
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
  const roles = getSessionRoles();
  const canAccess = roles.some((r: string) => TRAINING_ADMIN_ROLES.includes(r));

  if (!canAccess) {
    return <PermissionDenied module="training feedback" requiredRoles={TRAINING_ADMIN_ROLES} />;
  }

  const { data: items, source } = await getData();

  const columns: { key: keyof Row & string; label: string }[] = [
    { key: "employee", label: "Employee" },
    { key: "program", label: "Program" },
    { key: "rating", label: "Overall Rating" },
    { key: "submittedOn", label: "Submitted" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Training Feedback" subtitle="Post-training feedback and program ratings." back="/hr" />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="📋" iconBg="#e6f0ff" label="Total" value={items.length} />
        <StatCard icon="📚" iconBg="#e6f7f0" label="Programs" value={new Set(items.map((i) => i.program)).size} />
        <StatCard icon="👥" iconBg="#fffbe6" label="Employees" value={new Set(items.map((i) => i.employee)).size} />
        <StatCard icon="⭐" iconBg="#f5f5f5" label="Avg Rating" value={items.length > 0 ? (items.reduce((s, i) => {
          const parsed = parseFloat(i.rating);
          return s + (isNaN(parsed) ? 0 : parsed);
        }, 0) / items.length).toFixed(1) : "—"} />
      </StatGrid>
      <Card title="Training Feedback">
        {source === "error" ? (
          <RefreshErrorState error={toHumanError("load", { area: "training feedback" })} />
        ) : (
          <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter…"
            pageSize={15}
            emptyIcon="📝"
            emptyTitle="No training feedback"
            emptyMessage="Employee feedback on completed training programmes appears here. Feedback is collected at programme closure."
          />
        )}
      </Card>
    </main>
  );
}
