import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { getTranslations } from "next-intl/server";
import { formatIndianDate } from "@/lib/formatters";
import { NominationsTable, type NominationRow } from "./NominationsTable";

type RawRow = {
  id: string;
  trainingId: string;
  employee: string;
  department: string;
  program: string;
  nominatedBy: string;
  nominationDate: string;
  programDate: string;
  status: string;
};

type Payload = { rows: NominationRow[]; total: number; truncated: boolean };

async function getData(): Promise<LoaderResult<Payload>> {
  return fetchJson<unknown, Payload>("/api/v1/hrms/training/nominations", { rows: [], total: 0, truncated: false }, {
    telemetryKey: "hr.training_nominations",
    mapResponse: (p) => {
      const body = p as { data?: RawRow[]; total?: number; truncated?: boolean } | null;
      const arr = body?.data;
      if (!Array.isArray(arr)) return null;
      const rows: NominationRow[] = arr.map((r) => ({
        id: r.id,
        trainingId: r.trainingId,
        employee: r.employee,
        department: r.department,
        program: r.program,
        nominatedBy: r.nominatedBy,
        // GAP-HR-TRAINING-NOMINATIONS-03: formatted here (mapResponse), not
        // via a DataTable `render:` prop -- this is a Server Component; see
        // GAP-HR-TRAINING-FEEDBACK-01 for why `render` can't cross that
        // boundary. "—" (no date) passes through formatIndianDate unchanged.
        nominationDateDisplay: formatIndianDate(r.nominationDate),
        programDateDisplay: formatIndianDate(r.programDate),
        status: r.status,
      }));
      return { rows, total: body?.total ?? rows.length, truncated: Boolean(body?.truncated) };
    },
  });
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

  const { data, source } = await getData();
  const { rows, total, truncated } = data;
  const isError = source === "error";

  return (
    <div className="page-main wrap">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr" backLabel={t("backLabel")} />
      <DataSourceBadge source={source} />
      <StatGrid>
        {/* GAP-HR-TRAINING-NOMINATIONS-04: a genuine total (never data.length
            capped at 500), and "—" (not a fabricated 0) when the load
            itself failed. */}
        <StatCard icon="📋" iconBg="var(--infobg, #e6f0ff)" label={t("statTotal")} value={isError ? "—" : total} />
        {/* GAP-HR-TRAINING-NOMINATIONS-01: a freshly created nomination is
            stored as 'nominated', not 'pending' -- this used to always read
            0. */}
        <StatCard icon="⏳" iconBg="var(--warnbg, #fffbe6)" label={t("statPending")} value={isError ? "—" : rows.filter((r) => r.status === "nominated").length} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statApproved")} value={isError ? "—" : rows.filter((r) => r.status === "approved").length} />
        {/* GAP-HR-TRAINING-NOMINATIONS-05: distinct by trainingId, not by
            program-title text (two programmes that happen to share a title
            used to merge into one). */}
        <StatCard icon="📚" iconBg="var(--bg, #f5f5f5)" label={t("statPrograms")} value={isError ? "—" : new Set(rows.map((r) => r.trainingId)).size} />
      </StatGrid>
      {truncated && !isError && (
        <p className="text-xs text-amber-700" style={{ marginBottom: 8 }}>
          {t("truncatedNotice", { shown: rows.length, total } as never)}
        </p>
      )}
      <Card title={t("cardTitle")}>
        {isError ? (
          <RefreshErrorState error={toHumanError("load", { area: "training nominations" })} />
        ) : (
          <NominationsTable
            rows={rows}
            labels={{
              colEmployee: t("colEmployee"),
              colDepartment: t("colDepartment"),
              colProgram: t("colProgram"),
              colNominatedBy: t("colNominatedBy"),
              colProgramDate: t("colProgramDate"),
              colNominationDate: t("colNominationDate"),
              colStatus: t("colStatus"),
              colActions: t("colActions"),
              filterPlaceholder: t("filterPlaceholder"),
              emptyTitle: t("emptyTitle"),
              emptyMessage: t("emptyMessage"),
            }}
          />
        )}
      </Card>
    </div>
  );
}
