"use client";

import type { AppraisalSummary } from "@civitasone/types";

const APAR_BANDS: {
  label: string;
  minRating: number;
  maxRating: number;
  badgeClass: string;
}[] = [
  { label: "Outstanding",  minRating: 9,   maxRating: 10,  badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  { label: "Very Good",    minRating: 7,   maxRating: 8.99, badgeClass: "bg-blue-50 text-blue-700 border-blue-200" },
  { label: "Good",         minRating: 5,   maxRating: 6.99, badgeClass: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  { label: "Satisfactory", minRating: 3,   maxRating: 4.99, badgeClass: "bg-amber-50 text-amber-700 border-amber-200" },
  { label: "Poor",         minRating: 0,   maxRating: 2.99, badgeClass: "bg-red-50 text-red-700 border-red-200" },
];

interface APARRatingDistributionProps {
  appraisals: AppraisalSummary[];
}

export function APARRatingDistribution({ appraisals }: APARRatingDistributionProps) {
  const completed = appraisals.filter((a) => a.status === "completed" && a.rating != null);
  if (completed.length === 0) return null;

  const distribution = APAR_BANDS.map((band) => ({
    ...band,
    count: completed.filter(
      (a) =>
        a.rating != null &&
        a.rating >= band.minRating &&
        a.rating <= band.maxRating
    ).length,
  }));

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4 mb-6">
      <h3 className="text-sm font-semibold text-slate-800 mb-3">APAR Rating Distribution</h3>
      <div className="flex flex-wrap gap-2" role="list" aria-label="APAR rating distribution">
        {distribution.map(({ label, count, badgeClass }) => (
          <div
            key={label}
            role="listitem"
            className={[
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold",
              badgeClass,
            ].join(" ")}
            aria-label={`${label}: ${count} employee${count !== 1 ? "s" : ""}`}
          >
            {label}
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-white bg-opacity-60 text-[10px] font-bold px-1">
              {count}
            </span>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-slate-400 mt-3">
        Based on {completed.length} completed appraisal{completed.length !== 1 ? "s" : ""} with ratings.
        Scale: Outstanding (9–10), Very Good (7–8.9), Good (5–6.9), Satisfactory (3–4.9), Poor (&lt;3).
      </p>
    </div>
  );
}
