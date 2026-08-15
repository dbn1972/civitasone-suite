"use client";

import type { AppraisalSummary } from "@civitasone/types";

interface AppraisalCycleProgressProps {
  appraisals: AppraisalSummary[];
  /** ISO date when this cycle closes */
  cycleEndDate?: string;
}

function daysRemaining(iso: string): number {
  const end = new Date(iso);
  const now = new Date();
  const diff = end.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

export function AppraisalCycleProgress({ appraisals, cycleEndDate }: AppraisalCycleProgressProps) {
  const total = appraisals.length;
  if (total === 0) return null;

  const submitted = appraisals.filter(
    (a) => a.status === "in_review" || a.status === "completed"
  ).length;

  const pendingManagerReview = appraisals.filter(
    (a) => a.status === "in_review"
  ).length;

  const pct = Math.round((submitted / total) * 100);
  const days = cycleEndDate ? daysRemaining(cycleEndDate) : null;
  const isUrgent = days !== null && days <= 7;

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5 mb-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Cycle Progress</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {submitted} of {total} employee{total !== 1 ? "s" : ""} submitted
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {days !== null && (
            <span
              className={[
                "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                isUrgent
                  ? "bg-red-50 text-red-700 border border-red-200"
                  : "bg-blue-50 text-blue-700 border border-blue-200",
              ].join(" ")}
              aria-label={`${days} days remaining in this cycle`}
            >
              <span aria-hidden="true">{isUrgent ? "🔴" : "📅"}</span>
              {days}d remaining
            </span>
          )}
          {pendingManagerReview > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-xs font-semibold text-amber-700"
              aria-label={`${pendingManagerReview} pending manager reviews`}
            >
              <span aria-hidden="true">⏳</span>
              {pendingManagerReview} pending review{pendingManagerReview !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-slate-500 mb-1">
          <span>Submitted</span>
          <span className="font-semibold text-slate-700">{pct}%</span>
        </div>
        <div className="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden">
          <div
            className={[
              "h-full rounded-full transition-all duration-700",
              pct >= 80
                ? "bg-emerald-500"
                : pct >= 50
                ? "bg-indigo-500"
                : "bg-amber-500",
            ].join(" ")}
            style={{ width: `${pct}%` }}
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${pct}% of appraisals submitted`}
          />
        </div>
        <div className="flex justify-between text-[10px] text-slate-400 mt-0.5">
          <span>0</span>
          <span>{total} employees</span>
        </div>
      </div>
    </div>
  );
}
