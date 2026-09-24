import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, EmptyState, RefreshErrorState } from "../../../_components/ds";
import { getTrainingPrograms } from "../../../_data/loaders";
import { formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { UpcomingPrograms } from "./_components/UpcomingPrograms";
import { ProgramCard } from "./_components/ProgramCard";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { getTranslations } from "next-intl/server";

/**
 * Mirrors training/routes.ts: POST /v1/hrms/trainings requires
 * HR_ROLES = ["hr_admin", "hr_officer", "super_admin"].
 * The program list (GET) is available to ALL_ROLES (incl. employee, manager).
 */
const TRAINING_ADMIN_ROLES = ["hr_admin", "hr_officer", "super_admin"];

export default async function TrainingPage() {
  const t = await getTranslations("training");
  const { data: programs, source } = await getTrainingPrograms();
  const roles = getSessionRoles();
  const canCreate = roles.some((r: string) => TRAINING_ADMIN_ROLES.includes(r));

  const total = programs.length;
  const upcoming = programs.filter((p) => p.status === "upcoming").length;
  const ongoing = programs.filter((p) => p.status === "ongoing").length;
  const completed = programs.filter((p) => p.status === "completed").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        back="/hr" backLabel="Back to HR"
        subtitle={t("subtitle")}
        actions={
          canCreate ? (
            <Link href="/hr/training/new" className="btn primary">{t("newProgram")}</Link>
          ) : undefined
        }
      />
      <DataSourceBadge source={source} />

      {source === "error" ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <RefreshErrorState error={toHumanError("load", { area: "training programmes" })} />
        </div>
      ) : total === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <EmptyState
            icon="🏆"
            title={t("emptyTitle")}
            message={t("emptyMessage")}
            action={canCreate ? <Link href="/hr/training/new" className="btn primary">{t("scheduleProgram")}</Link> : undefined}
          />
        </div>
      ) : (
        <>
          <StatGrid>
            <StatCard icon="📋" iconBg="var(--bg, #f5f5f5)" label={t("statTotal")} value={total} />
            <StatCard icon="📅" iconBg="var(--infobg, #e6f0ff)" label={t("statUpcoming")} value={upcoming} />
            <StatCard icon="▶️" iconBg="var(--goodbg, #e6f7f0)" label={t("statOngoing")} value={ongoing} />
            <StatCard icon="✅" iconBg="var(--warnbg, #fffbe6)" label={t("statCompleted")} value={completed} />
          </StatGrid>

          {/* Upcoming Programs fast-access strip */}
          {upcoming > 0 && (
            <UpcomingPrograms programs={programs} />
          )}

          {/* Full program grid */}
          <Card title={t("allProgramsTitle")}>
            {programs.length > 0 ? (
              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {programs.map((p) => (
                  <ProgramCard
                    key={p.id}
                    program={p}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                icon="📚"
                title={t("innerEmptyTitle")}
                message={t("innerEmptyMessage")}
                action={canCreate ? <Link href="/hr/training/new" className="btn primary">{t("newProgram")}</Link> : undefined}
              />
            )}
          </Card>

          <div style={{ marginTop: 12, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link href="/hr/training/nominations" className="btn ghost">{t("viewNominations")}</Link>
            <Link href="/hr/training/feedback" className="btn ghost">{t("feedbackReports")}</Link>
          </div>
        </>
      )}
    </main>
  );
}
