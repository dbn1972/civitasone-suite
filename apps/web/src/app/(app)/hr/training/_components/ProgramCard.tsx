"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { TrainingProgramSummary } from "@civitasone/types";
import { formatIndianDate } from "@/lib/formatters";

const MODE_STYLE: Record<string, string> = {
  online:    "bg-blue-50 text-blue-700 border-blue-200",
  classroom: "bg-amber-50 text-amber-700 border-amber-200",
  blended:   "bg-purple-50 text-purple-700 border-purple-200",
};
const CATEGORY_STYLE: Record<string, string> = {
  leadership: "bg-indigo-50 text-indigo-700 border-indigo-200",
  optional:   "bg-slate-50 text-slate-600 border-slate-200",
  mandatory:  "bg-red-50 text-red-700 border-red-200",
};
const STATUS_STYLE: Record<string, string> = {
  upcoming:  "bg-blue-50 text-blue-700",
  ongoing:   "bg-emerald-50 text-emerald-700",
  completed: "bg-slate-100 text-slate-600",
  cancelled: "bg-red-50 text-red-600",
};

/**
 * GAP-HR-TRAINING-03: whole calendar-day count (inclusive), not an
 * hours-between-two-UTC-midnights figure -- the old calcDurationHrs()
 * rounded (end-start)/3.6e6, so a same-day course showed "< 1 hr" and a
 * 3-day course showed "48 hrs". Two YYYY-MM-DD dates with no time-of-day
 * component can only honestly express a day count.
 */
function durationDays(start: string, end: string): number | null {
  const s = new Date(start);
  const e = new Date(end);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return null;
  return Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1;
}

export interface ProgramCardProps {
  program: TrainingProgramSummary;
}

/**
 * GAP-HR-TRAINING-01/02/03/06: this card used to (a) guess `mode` from venue
 * text keywords and default any unrecognised `category` to "Mandatory" -- a
 * compliance label with no data behind it -- and (b) offer an `onEnroll`
 * callback prop that page.tsx, a Server Component, could never actually
 * pass, so the button silently never rendered. Category/mode are now the
 * API's real, possibly-null values (migration 0162); a null value renders
 * no badge rather than a guess. Enroll now navigates to the programme
 * detail page (GAP-HR-TRAINING-01, `/hr/training/[id]`), which is
 * RSC-safe by construction and matches how UpcomingPrograms' own Enroll
 * link already worked.
 */
export function ProgramCard({ program }: ProgramCardProps) {
  const t = useTranslations("training");
  const modeLabel = program.mode ? t(`mode.${program.mode}` as never) : null;
  const categoryLabel = program.category ? t(`category.${program.category}` as never) : null;
  const days = durationDays(program.startDate, program.endDate);
  const seatsLeft = program.maxCapacity != null ? program.maxCapacity - program.enrolledCount : null;
  const deadlineLabel = program.enrollmentDeadline ? formatIndianDate(program.enrollmentDeadline) : null;
  const full = seatsLeft !== null && seatsLeft <= 0;

  return (
    <div className="rounded-xl border shadow-sm p-4 flex flex-col gap-3 hover:shadow-md transition-shadow"
      style={{ background: "var(--panel, #fff)", borderColor: "var(--line, #e2e8f0)" }}>
      {/* Title + status */}
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-slate-800 text-sm leading-snug">{program.title}</p>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_STYLE[program.status] ?? "bg-slate-100 text-slate-600"}`}>
          {t(`status.${program.status}` as never)}
        </span>
      </div>

      {/* Mode + category + duration badges */}
      <div className="flex flex-wrap gap-1.5">
        {modeLabel && (
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${MODE_STYLE[program.mode as string] ?? MODE_STYLE.classroom}`}>
            {modeLabel}
          </span>
        )}
        {categoryLabel && (
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${CATEGORY_STYLE[program.category as string] ?? CATEGORY_STYLE.optional}`}>
            {categoryLabel}
          </span>
        )}
        {days !== null && (
          <span className="inline-flex items-center gap-0.5 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
            <span aria-hidden="true">⏱</span> {t("duration", { days } as never)}
          </span>
        )}
      </div>

      {/* Dates + trainer */}
      <dl className="grid grid-cols-2 gap-1.5 text-xs">
        <div>
          <dt className="text-slate-500">{t("startDate")}</dt>
          <dd className="font-medium text-slate-800">{formatIndianDate(program.startDate)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">{t("endDate")}</dt>
          <dd className="font-medium text-slate-800">{formatIndianDate(program.endDate)}</dd>
        </div>
        {program.trainerName && (
          <div>
            <dt className="text-slate-500">{t("trainer")}</dt>
            <dd className="font-medium text-slate-800 truncate">{program.trainerName}</dd>
          </div>
        )}
        {deadlineLabel && (
          <div>
            <dt className="text-slate-500">{t("enrolBy")}</dt>
            <dd className="font-medium text-amber-700">{deadlineLabel}</dd>
          </div>
        )}
      </dl>

      {/* Seats + enroll */}
      {program.status === "upcoming" && (
        <div className="flex items-center justify-between pt-2 border-t border-slate-100">
          {seatsLeft !== null ? (
            <span className={`text-xs ${seatsLeft <= 5 ? "text-amber-600 font-medium" : "text-slate-500"}`}>
              {full ? t("fullyEnrolled") : t("seatsLeft", { count: seatsLeft } as never)}
            </span>
          ) : (
            <span className="text-xs text-slate-500">{t("enrolledCount", { count: program.enrolledCount } as never)}</span>
          )}
          <Link
            href={`/hr/training/${program.id}`}
            aria-disabled={full ? "true" : undefined}
            className={[
              "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors text-center",
              full
                ? "bg-slate-100 text-slate-400 pointer-events-none"
                : "bg-indigo-600 text-white hover:bg-indigo-500",
            ].join(" ")}
          >
            {full ? t("full") : t("enroll")}
          </Link>
        </div>
      )}
    </div>
  );
}
