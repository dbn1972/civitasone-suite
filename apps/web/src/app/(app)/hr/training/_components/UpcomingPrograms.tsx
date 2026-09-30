"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { TrainingProgramSummary } from "@civitasone/types";
import { formatIndianDate } from "@/lib/formatters";

const MODE_MAP: Record<string, string> = {
  online:    "bg-blue-50 text-blue-700 border-blue-200",
  classroom: "bg-amber-50 text-amber-700 border-amber-200",
  blended:   "bg-purple-50 text-purple-700 border-purple-200",
};

const CATEGORY_DOT: Record<string, string> = {
  mandatory:  "bg-red-500",
  optional:   "bg-slate-400",
  leadership: "bg-indigo-500",
};

/** GAP-HR-TRAINING-03: see ProgramCard.tsx's identical helper doc comment. */
function durationDays(start: string, end: string): number | null {
  const s = new Date(start);
  const e = new Date(end);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return null;
  return Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1;
}

interface UpcomingProgramsProps {
  programs: TrainingProgramSummary[];
}

/**
 * GAP-HR-TRAINING-02/03/06: category/mode used to be guessed (defaulting
 * any unrecognised category to "Mandatory", and mode from venue-text
 * keywords) and every string here was hard-coded English with a local
 * formatIndianDate copy that diverged from lib/formatters' (dd Mon yyyy vs
 * the shared dd/MM/yyyy). Category/mode are now the API's real, possibly
 * null values (migration 0162) -- a null value renders no badge -- and all
 * copy goes through next-intl. The Enroll `Link` itself (as opposed to
 * ProgramCard's old broken `onEnroll` callback) already correctly
 * navigated to `/hr/training/${p.id}`; GAP-HR-TRAINING-01 is what makes
 * that destination a real page instead of a 404.
 */
export function UpcomingPrograms({ programs }: UpcomingProgramsProps) {
  const t = useTranslations("training");
  const now = new Date();
  const upcoming = programs
    .filter((p) => p.status === "upcoming" && new Date(p.startDate) > now)
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
    .slice(0, 5);

  if (upcoming.length === 0) {
    return null;
  }

  return (
    <div className="rounded-xl border shadow-sm overflow-hidden mb-6"
      style={{ background: "var(--panel, #fff)", borderColor: "var(--line, #e2e8f0)" }}>
      <div className="px-5 py-4 border-b border-slate-100">
        <h3 className="text-base font-semibold text-slate-800">{t("upcomingHeading")}</h3>
        <p className="text-xs text-slate-500 mt-0.5">{t("upcomingSubtitle", { count: upcoming.length } as never)}</p>
      </div>
      <div className="divide-y divide-slate-100">
        {upcoming.map((p) => {
          const modeLabel = p.mode ? t(`mode.${p.mode}` as never) : null;
          const categoryLabel = p.category ? t(`category.${p.category}` as never) : null;
          const modeStyle = p.mode ? (MODE_MAP[p.mode] ?? MODE_MAP.classroom) : null;
          const categoryDot = p.category ? (CATEGORY_DOT[p.category] ?? CATEGORY_DOT.optional) : null;
          const seatsLeft = p.maxCapacity != null ? p.maxCapacity - p.enrolledCount : null;
          const full = seatsLeft !== null && seatsLeft <= 0;
          const days = durationDays(p.startDate, p.endDate);

          return (
            <div key={p.id} className="px-5 py-4 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <p className="font-semibold text-slate-800 text-sm truncate">{p.title}</p>
                  {modeLabel && (
                    <span className={["inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium", modeStyle].join(" ")}>
                      {modeLabel}
                    </span>
                  )}
                  {categoryLabel && (
                    <span className="flex items-center gap-1 text-[11px] text-slate-500">
                      <span aria-hidden="true" className={`inline-block w-1.5 h-1.5 rounded-full ${categoryDot}`} />
                      {categoryLabel}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
                  <span>
                    <span aria-hidden="true">📅</span>{" "}
                    {formatIndianDate(p.startDate)}
                  </span>
                  {days !== null && (
                    <span>
                      <span aria-hidden="true">⏱</span> {t("duration", { days } as never)}
                    </span>
                  )}
                  {p.trainerName && <span>{p.trainerName}</span>}
                  {seatsLeft !== null && (
                    <span className={seatsLeft <= 5 ? "text-amber-600 font-medium" : ""}>
                      {t("seatsLeft", { count: seatsLeft } as never)}
                    </span>
                  )}
                </div>
              </div>
              <Link
                href={`/hr/training/${p.id}`}
                aria-disabled={full ? "true" : undefined}
                className={[
                  "shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors text-center",
                  full
                    ? "bg-slate-100 text-slate-400 pointer-events-none"
                    : "bg-indigo-600 text-white hover:bg-indigo-500",
                ].join(" ")}
              >
                {full ? t("full") : t("enroll")}
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}
