import Link from "next/link";
import { getTrainingPrograms, getMyProfile } from "../../../../_data/loaders";
import { fetchJson } from "@/app/_data/apiClient";
import { PageHeader, Card, DataTable, EmptyState, RefreshErrorState, StatusPill } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { formatIndianDate, formatClockTime12h } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { getTranslations } from "next-intl/server";
import { EnrollButton } from "./EnrollButton";

type SessionRow = {
  id: string;
  title: string;
  sessionDateDisplay: string;
  timeDisplay: string;
  venue: string;
  capacity: number;
  status: string;
} & Record<string, unknown>;

async function getSessions(trainingId: string) {
  return fetchJson<unknown, SessionRow[]>(`/api/v1/hrms/trainings/${trainingId}/sessions`, [], {
    telemetryKey: "hr.training_sessions",
    // Pre-format the display fields here, not via a DataTable `render:` prop
    // -- this is a Server Component, and `render` cannot cross into
    // DataTable ("use client"); see GAP-HR-TRAINING-FEEDBACK-01 / PR #1647
    // for the bug class this avoids.
    mapResponse: (p) => {
      if (!Array.isArray(p)) return null;
      return p.map((raw) => {
        const s = raw as Record<string, unknown>;
        const startTime = typeof s.startTime === "string" ? s.startTime : null;
        const endTime = typeof s.endTime === "string" ? s.endTime : null;
        return {
          id: String(s.id),
          title: String(s.title ?? "—"),
          sessionDateDisplay: formatIndianDate(typeof s.sessionDate === "string" ? s.sessionDate : null),
          timeDisplay: startTime
            ? `${formatClockTime12h(startTime)}${endTime ? ` – ${formatClockTime12h(endTime)}` : ""}`
            : "—",
          venue: typeof s.venue === "string" && s.venue ? s.venue : "—",
          capacity: Number(s.capacity ?? 0),
          status: String(s.status ?? "scheduled"),
        };
      });
    },
  });
}

/**
 * GAP-HR-TRAINING-01: this page (and EnrollButton.tsx) did not exist --
 * every "Enroll" link across the training hub (ProgramCard, UpcomingPrograms)
 * pointed at `/hr/training/${id}` and 404'd; see hr.md's dead-route contract
 * test (PR #1660, KNOWN_EXCEPTIONS) for the interim containment this
 * replaces for real.
 *
 * Enrolment-flow decision (self-enrol vs HR-nominates-on-behalf), which the
 * catalog flagged as blocking this fix: re-verified against the CURRENT
 * backend (services/hrms-service/src/modules/training/routes.ts,
 * resolveOwnEmployeeIdIfNonHr/resolveOwnEmployeeIdIfBareEmployee, both
 * commented "IDOR fix (audit)") -- POST /v1/hrms/nominations already ships
 * BOTH: any non-HR caller (employee or manager) is force-scoped server-side
 * to their OWN resolveEmployeeForActor id regardless of what employeeId they
 * submit, while HR can nominate any employeeId. That decision is not
 * pending; it is already built, audited and live. This page only adds the
 * missing UI reaching that already-secured endpoint -- self-enrol only
 * ("Enroll me"), not an HR-nominates-a-colleague picker: that needs its own
 * employee-search backend endpoint (EntityPicker itself already exists,
 * ds/EntityPicker.tsx, but no employee-search adapter or route backs it
 * anywhere in this repo yet), which is a separate, undecided piece of scope
 * -- flagged in the PR description rather than half-built here.
 */
export default async function TrainingDetailPage({ params }: { params: { id: string } }) {
  const t = await getTranslations("trainingDetail");
  const tTraining = await getTranslations("training");
  const [{ data: programs, source: programsSource }, { data: sessions, source: sessionsSource }, { data: myProfile }] = await Promise.all([
    getTrainingPrograms(),
    getSessions(params.id),
    getMyProfile(),
  ]);

  if (programsSource === "error") {
    return (
      <div className="page-main wrap">
        <PageHeader title={t("title")} back="/hr/training" backLabel={t("backLabel")} />
        <RefreshErrorState error={toHumanError("load", { area: "training programme" })} />
      </div>
    );
  }

  const program = programs.find((p) => p.id === params.id);
  if (!program) {
    return (
      <div className="page-main wrap">
        <PageHeader title={t("title")} back="/hr/training" backLabel={t("backLabel")} />
        <EmptyState
          icon="🔍"
          title={t("notFoundTitle")}
          message={t("notFoundMessage")}
          action={<Link href="/hr/training" className="btn primary">{t("backToList")}</Link>}
        />
      </div>
    );
  }

  const seatsLeft = program.maxCapacity != null ? program.maxCapacity - program.enrolledCount : null;
  const full = seatsLeft !== null && seatsLeft <= 0;
  const canEnroll = program.status === "upcoming" && !full;
  const disabledReason = program.status !== "upcoming" ? t("notOpenForEnrolment") : full ? t("fullDisabled") : undefined;

  const sessionColumns: { key: keyof SessionRow & string; label: string; cellType?: "status" }[] = [
    { key: "title", label: t("sessionTitle") },
    { key: "sessionDateDisplay", label: t("sessionDate") },
    { key: "timeDisplay", label: t("sessionTime") },
    { key: "venue", label: t("sessionVenue") },
    { key: "status", label: t("sessionStatus"), cellType: "status" },
  ];

  return (
    <div className="page-main wrap">
      <PageHeader title={program.title} subtitle={t("subtitle")} back="/hr/training" backLabel={t("backLabel")} />
      <DataSourceBadge source={programsSource} />

      <Card title={t("detailsTitle")}>
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4 p-4 text-sm">
          <div>
            <dt className="text-slate-500 text-xs">{t("status")}</dt>
            <dd><StatusPill status={program.status} /></dd>
          </div>
          <div>
            <dt className="text-slate-500 text-xs">{tTraining("startDate")}</dt>
            <dd className="font-medium">{formatIndianDate(program.startDate)}</dd>
          </div>
          <div>
            <dt className="text-slate-500 text-xs">{tTraining("endDate")}</dt>
            <dd className="font-medium">{formatIndianDate(program.endDate)}</dd>
          </div>
          {program.venue && (
            <div>
              <dt className="text-slate-500 text-xs">{t("venue")}</dt>
              <dd className="font-medium">{program.venue}</dd>
            </div>
          )}
          {program.trainerName && (
            <div>
              <dt className="text-slate-500 text-xs">{tTraining("trainer")}</dt>
              <dd className="font-medium">{program.trainerName}</dd>
            </div>
          )}
          {program.category && (
            <div>
              <dt className="text-slate-500 text-xs">{t("category")}</dt>
              <dd className="font-medium">{tTraining(`category.${program.category}` as never)}</dd>
            </div>
          )}
          {program.mode && (
            <div>
              <dt className="text-slate-500 text-xs">{t("mode")}</dt>
              <dd className="font-medium">{tTraining(`mode.${program.mode}` as never)}</dd>
            </div>
          )}
          {program.enrollmentDeadline && (
            <div>
              <dt className="text-slate-500 text-xs">{tTraining("enrolBy")}</dt>
              <dd className="font-medium text-amber-700">{formatIndianDate(program.enrollmentDeadline)}</dd>
            </div>
          )}
          <div>
            <dt className="text-slate-500 text-xs">{t("seats")}</dt>
            <dd className="font-medium">
              {seatsLeft !== null ? tTraining("seatsLeft", { count: seatsLeft } as never) : tTraining("enrolledCount", { count: program.enrolledCount } as never)}
            </dd>
          </div>
        </dl>

        <div className="px-4 pb-4">
          {canEnroll ? (
            <EnrollButton trainingId={program.id} employeeId={myProfile?.id ?? null} />
          ) : (
            <p className="text-sm text-slate-500">{disabledReason}</p>
          )}
        </div>
      </Card>

      <Card title={t("sessionsTitle")}>
        {sessionsSource === "error" ? (
          <RefreshErrorState error={toHumanError("load", { area: "training sessions" })} />
        ) : (
          <DataTable<SessionRow>
            columns={sessionColumns}
            rows={sessions}
            emptyIcon="🗓️"
            emptyTitle={t("noSessionsTitle")}
            emptyMessage={t("noSessionsMessage")}
          />
        )}
      </Card>
    </div>
  );
}
