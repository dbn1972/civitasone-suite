"use client";

import type { TrainingProgramSummary } from "@civitasone/types";

function formatIndianDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function calcDurationHrs(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return "—";
  const hrs = Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60));
  return hrs < 1 ? "< 1 hr" : `${hrs} hr${hrs !== 1 ? "s" : ""}`;
}

const MODE_STYLE: Record<string, string> = {
  online:    "bg-blue-50 text-blue-700 border-blue-200",
  classroom: "bg-amber-50 text-amber-700 border-amber-200",
  blended:   "bg-purple-50 text-purple-700 border-purple-200",
};
const MODE_LABEL: Record<string, string> = {
  online: "Online", classroom: "Classroom", blended: "Blended",
};
const STATUS_STYLE: Record<string, string> = {
  upcoming:  "bg-blue-50 text-blue-700",
  ongoing:   "bg-emerald-50 text-emerald-700",
  completed: "bg-slate-100 text-slate-600",
  cancelled: "bg-red-50 text-red-600",
};

function deriveMode(program: TrainingProgramSummary): string {
  const v = program.venue?.toLowerCase() ?? "";
  if (v.includes("online") || v.includes("virtual") || v.includes("webinar")) return "online";
  if (v.includes("blend")) return "blended";
  return "classroom";
}

function deriveCategory(category: string): { label: string; badgeClass: string } {
  const c = category.toLowerCase();
  if (c.includes("leader")) return { label: "Leadership", badgeClass: "bg-indigo-50 text-indigo-700 border-indigo-200" };
  if (c.includes("opt") || c.includes("elective")) return { label: "Optional", badgeClass: "bg-slate-50 text-slate-600 border-slate-200" };
  return { label: "Mandatory", badgeClass: "bg-red-50 text-red-700 border-red-200" };
}

export interface ProgramCardProps {
  program: TrainingProgramSummary;
  enrollmentDeadline?: string;
  onEnroll?: () => void;
}

export function ProgramCard({ program, enrollmentDeadline, onEnroll }: ProgramCardProps) {
  const mode = deriveMode(program);
  const cat = deriveCategory(program.category);
  const duration = calcDurationHrs(program.startDate, program.endDate);
  const seatsLeft = program.maxCapacity != null ? program.maxCapacity - program.enrolledCount : null;
  const deadlineLabel = enrollmentDeadline ? formatIndianDate(enrollmentDeadline) : null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4 flex flex-col gap-3 hover:shadow-md transition-shadow">
      {/* Title + status */}
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-slate-800 text-sm leading-snug">{program.title}</p>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_STYLE[program.status] ?? "bg-slate-100 text-slate-600"}`}>
          {program.status}
        </span>
      </div>

      {/* Mode + category + duration badges */}
      <div className="flex flex-wrap gap-1.5">
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${MODE_STYLE[mode] ?? MODE_STYLE.classroom}`}>
          {MODE_LABEL[mode] ?? "Classroom"}
        </span>
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${cat.badgeClass}`}>
          {cat.label}
        </span>
        <span className="inline-flex items-center gap-0.5 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
          <span aria-hidden="true">⏱</span> {duration}
        </span>
      </div>

      {/* Dates + trainer */}
      <dl className="grid grid-cols-2 gap-1.5 text-xs">
        <div>
          <dt className="text-slate-500">Start date</dt>
          <dd className="font-medium text-slate-800">{formatIndianDate(program.startDate)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">End date</dt>
          <dd className="font-medium text-slate-800">{formatIndianDate(program.endDate)}</dd>
        </div>
        {program.trainerName && (
          <div>
            <dt className="text-slate-500">Trainer</dt>
            <dd className="font-medium text-slate-800 truncate">{program.trainerName}</dd>
          </div>
        )}
        {deadlineLabel && (
          <div>
            <dt className="text-slate-500">Enrol by</dt>
            <dd className="font-medium text-amber-700">{deadlineLabel}</dd>
          </div>
        )}
      </dl>

      {/* Seats + enroll */}
      {program.status === "upcoming" && (
        <div className="flex items-center justify-between pt-2 border-t border-slate-100">
          {seatsLeft !== null ? (
            <span className={`text-xs ${seatsLeft <= 5 ? "text-amber-600 font-medium" : "text-slate-500"}`}>
              {seatsLeft <= 0 ? "Fully enrolled" : `${seatsLeft} seat${seatsLeft !== 1 ? "s" : ""} left`}
            </span>
          ) : (
            <span className="text-xs text-slate-500">{program.enrolledCount} enrolled</span>
          )}
          {onEnroll && (
            <button
              type="button"
              onClick={onEnroll}
              disabled={seatsLeft !== null && seatsLeft <= 0}
              className={[
                "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                seatsLeft !== null && seatsLeft <= 0
                  ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                  : "bg-indigo-600 text-white hover:bg-indigo-500",
              ].join(" ")}
            >
              Enroll
            </button>
          )}
        </div>
      )}
    </div>
  );
}
