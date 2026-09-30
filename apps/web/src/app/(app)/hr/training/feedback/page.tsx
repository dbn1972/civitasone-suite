import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { getTranslations } from "next-intl/server";
import { formatIndianDate } from "@/lib/formatters";

type Row = {
  id: string;
  employee: string;
  program: string;
  /**
   * GAP-HR-TRAINING-FEEDBACK-02: a real number|null -- never the old
   * `parseFloat(String(f.rating)) || 0`, which turned an unscored
   * completion's "—" into a fabricated 0.0 that then dragged the average
   * down. `null` (no completion score recorded) is display-only "—";
   * statAvgRating below only ever averages the rows that actually have one.
   */
  score: number | null;
  scoreDisplay: string;
  submittedOnDisplay: string;
} & Record<string, unknown>;

type Payload = { rows: Row[]; total: number; truncated: boolean };

async function getData(): Promise<LoaderResult<Payload>> {
  return fetchJson<unknown, Payload>("/api/v1/hrms/training/feedback", { rows: [], total: 0, truncated: false }, {
    telemetryKey: "hr.training_feedback",
    mapResponse: (p) => {
      const body = p as { data?: Array<Record<string, unknown>>; total?: number; truncated?: boolean } | null;
      const arr = body?.data;
      if (!Array.isArray(arr)) return null;
      const rows: Row[] = arr.map((f) => {
        const score = typeof f.score === "number" ? f.score : null;
        return {
          id: String(f.id),
          employee: String(f.employee ?? "—"),
          program: String(f.program ?? "—"),
          score,
          // GAP-HR-TRAINING-FEEDBACK-02: out of 100, never presented at a
          // 5-point/decimal scale that implies a different kind of rating.
          scoreDisplay: score === null ? "—" : `${score}/100`,
          // GAP-HR-TRAINING-FEEDBACK-04: formatted here (mapResponse), not
          // via a DataTable `render:` prop -- see GAP-HR-TRAINING-FEEDBACK-01
          // for why `render` can't cross the Server Component boundary.
          submittedOnDisplay: formatIndianDate(typeof f.submittedOn === "string" ? f.submittedOn : null),
        };
      });
      return { rows, total: body?.total ?? rows.length, truncated: Boolean(body?.truncated) };
    },
  });
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

  const { data, source } = await getData();
  const { rows, total, truncated } = data;
  const isError = source === "error";
  const scoredRows = rows.filter((r) => r.score !== null);

  const columns: { key: keyof Row & string; label: string }[] = [
    { key: "employee", label: t("colEmployee") },
    { key: "program", label: t("colProgram") },
    { key: "scoreDisplay", label: t("colScore") },
    { key: "submittedOnDisplay", label: t("colSubmitted") },
  ];

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr" backLabel={t("backLabel")} />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="📋" iconBg="var(--infobg, #e6f0ff)" label={t("statTotal")} value={isError ? "—" : total} />
        <StatCard icon="📚" iconBg="var(--goodbg, #e6f7f0)" label={t("statPrograms")} value={isError ? "—" : new Set(rows.map((r) => r.program)).size} />
        <StatCard icon="👥" iconBg="var(--warnbg, #fffbe6)" label={t("statEmployees")} value={isError ? "—" : new Set(rows.map((r) => r.employee)).size} />
        <StatCard
          icon="⭐"
          iconBg="var(--bg, #f5f5f5)"
          label={t("statAvgScore")}
          value={isError ? "—" : scoredRows.length > 0 ? `${(scoredRows.reduce((s, r) => s + (r.score as number), 0) / scoredRows.length).toFixed(1)}/100` : "—"}
        />
      </StatGrid>
      {truncated && !isError && (
        <p className="text-xs text-amber-700" style={{ marginBottom: 8 }}>
          {t("truncatedNotice", { shown: rows.length, total } as never)}
        </p>
      )}
      <Card title={t("cardTitle")}>
        {isError ? (
          <RefreshErrorState error={toHumanError("load", { area: "training feedback" })} />
        ) : (
          <DataTable<Row> columns={columns} rows={rows} sortable filterable filterPlaceholder={t("filterPlaceholder")}
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
