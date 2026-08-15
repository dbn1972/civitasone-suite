"use client";

function formatIndianDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const datePart = d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const timePart = d.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  return `${datePart} ${timePart}`;
}

export interface InterviewCardProps {
  candidateName: string;
  roleApplied: string;
  /** ISO 8601 datetime string */
  slotISO: string;
  interviewerName: string;
  meetLink?: string;
  onReschedule?: () => void;
  onCancel?: () => void;
}

export function InterviewCard({
  candidateName,
  roleApplied,
  slotISO,
  interviewerName,
  meetLink,
  onReschedule,
  onCancel,
}: InterviewCardProps) {
  const slotLabel = formatIndianDateTime(slotISO);

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4 flex flex-col gap-3">
      {/* Candidate + stage badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-slate-800 text-sm truncate">{candidateName}</p>
          <p className="text-xs text-slate-500 mt-0.5 truncate">{roleApplied}</p>
        </div>
        <span className="inline-flex items-center gap-1 shrink-0 rounded-full bg-purple-50 border border-purple-200 px-2.5 py-0.5 text-xs font-semibold text-purple-700">
          <span aria-hidden="true">📅</span> Interview
        </span>
      </div>

      {/* Slot + interviewer details */}
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="text-slate-500">Slot</dt>
          <dd className="font-semibold text-slate-800 mt-0.5">{slotLabel}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Interviewer</dt>
          <dd className="font-medium text-slate-800 mt-0.5">{interviewerName}</dd>
        </div>
      </dl>

      {/* Action row */}
      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
        {meetLink ? (
          <a
            href={meetLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 transition-colors"
          >
            <span aria-hidden="true">🎥</span> Join Meet
          </a>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-400 cursor-not-allowed">
            <span aria-hidden="true">🎥</span> No link yet
          </span>
        )}
        {onReschedule && (
          <button
            type="button"
            onClick={onReschedule}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Reschedule
          </button>
        )}
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1 rounded-md border border-red-100 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
