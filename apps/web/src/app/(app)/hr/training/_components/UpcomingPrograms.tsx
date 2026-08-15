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
  const diffMs = e.getTime() - s.getTime();
  const hrs = Math.round(diffMs / (1000 * 60 * 60));
  if (hrs < 1) return "< 1 hr";
  return `${hrs} hr${hrs !== 1 ? "s" : ""}`;
}

const MODE_MAP: Record<string, { label: string; color: string }> = {
  online:    { label: "Online",    color: "bg-blue-50 text-blue-700 border-blue-200" },
  classroom: { label: "Classroom", color: "bg-amber-50 text-amber-700 border-amber-200" },
  blended:   { label: "Blended",   color: "bg-purple-50 text-purple-700 border-purple-200" },
};

const CATEGORY_MAP: Record<string, { label: string; dot: string }> = {
  mandatory:  { label: "Mandatory",   dot: "bg-red-500" },
  optional:   { label: "Optional",    dot: "bg-slate-400" },
  leadership: { label: "Leadership",  dot: "bg-indigo-500" },
};

function deriveMode(program: TrainingProgramSummary): string {
  const v = program.venue?.toLowerCase() ?? "";
  if (v.includes("online") || v.includes("virtual") || v.includes("webinar")) return "online";
  if (v.includes("blend")) return "blended";
  return "classroom";
}

function deriveCategory(program: TrainingProgramSummary): string {
  const cat = program.category?.toLowerCase() ?? "";
  if (cat.includes("leader")) return "leadership";
  if (cat.includes("opt") || cat.includes("elective")) return "optional";
  return "mandatory";
}

interface UpcomingProgramsProps {
  programs: TrainingProgramSummary[];
  onEnroll?: (id: string) => void;
}

export function UpcomingPrograms({ programs, onEnroll }: UpcomingProgramsProps) {
  const now = new Date();
  const upcoming = programs
    .filter((p) => p.status === "upcoming" && new Date(p.startDate) > now)
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
    .slice(0, 5);

  if (upcoming.length === 0) {
    return null;
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden mb-6">
      <div className="px-5 py-4 border-b border-slate-100">
        <h3 className="text-base font-semibold text-slate-800">Upcoming Programs</h3>
        <p className="text-xs text-slate-500 mt-0.5">Next {upcoming.length} scheduled training{upcoming.length !== 1 ? "s" : ""}</p>
      </div>
      <div className="divide-y divide-slate-100">
        {upcoming.map((p) => {
          const mode = deriveMode(p);
          const category = deriveCategory(p);
          const modeStyle = MODE_MAP[mode] ?? MODE_MAP.classroom;
          const catStyle = CATEGORY_MAP[category] ?? CATEGORY_MAP.mandatory;
          const seatsLeft = p.maxCapacity != null ? p.maxCapacity - p.enrolledCount : null;
          const duration = calcDurationHrs(p.startDate, p.endDate);

          return (
            <div key={p.id} className="px-5 py-4 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <p className="font-semibold text-slate-800 text-sm truncate">{p.title}</p>
                  <span
                    className={[
                      "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                      modeStyle.color,
                    ].join(" ")}
                  >
                    {modeStyle.label}
                  </span>
                  <span className="flex items-center gap-1 text-[11px] text-slate-500">
                    <span
                      aria-hidden="true"
                      className={`inline-block w-1.5 h-1.5 rounded-full ${catStyle.dot}`}
                    />
                    {catStyle.label}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
                  <span>
                    <span aria-hidden="true">📅</span>{" "}
                    {formatIndianDate(p.startDate)}
                  </span>
                  <span>
                    <span aria-hidden="true">⏱</span> {duration}
                  </span>
                  {p.trainerName && <span>{p.trainerName}</span>}
                  {seatsLeft !== null && (
                    <span className={seatsLeft <= 5 ? "text-amber-600 font-medium" : ""}>
                      {seatsLeft} seat{seatsLeft !== 1 ? "s" : ""} left
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onEnroll?.(p.id)}
                disabled={seatsLeft !== null && seatsLeft <= 0}
                className={[
                  "shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                  seatsLeft !== null && seatsLeft <= 0
                    ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                    : "bg-indigo-600 text-white hover:bg-indigo-500",
                ].join(" ")}
              >
                {seatsLeft !== null && seatsLeft <= 0 ? "Full" : "Enroll"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
