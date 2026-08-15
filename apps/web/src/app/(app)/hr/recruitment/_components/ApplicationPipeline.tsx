"use client";

const ORDERED_STAGES: { key: string; label: string }[] = [
  { key: "applied",      label: "Received" },
  { key: "shortlisted",  label: "Shortlisted" },
  { key: "interviewing", label: "Interview" },
  { key: "offered",      label: "Offer" },
  { key: "hired",        label: "Joined" },
];

interface ApplicationPipelineProps {
  applications: { stage: string }[];
  activeStage: string;
  onStageClick: (stage: string) => void;
}

export function ApplicationPipeline({
  applications,
  activeStage,
  onStageClick,
}: ApplicationPipelineProps) {
  const counts = ORDERED_STAGES.reduce<Record<string, number>>((acc, { key }) => {
    acc[key] = applications.filter((a) => a.stage === key).length;
    return acc;
  }, {});

  return (
    <div className="mb-5" aria-label="Application pipeline">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
        Application Pipeline
      </p>
      <div className="flex rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {ORDERED_STAGES.map(({ key, label }, idx) => {
          const isActive = activeStage === key;
          const count = counts[key] ?? 0;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onStageClick(isActive ? "all" : key)}
              aria-pressed={isActive}
              aria-label={`${label}: ${count} applications. Click to filter.`}
              className={[
                "flex-1 flex flex-col items-center justify-center gap-1 py-3 px-2",
                "transition-colors duration-150 relative",
                isActive
                  ? "bg-indigo-600 text-white"
                  : "hover:bg-slate-50 text-slate-700",
                idx > 0 ? "border-l border-slate-200" : "",
              ].filter(Boolean).join(" ")}
            >
              <span
                className={[
                  "text-xl font-bold leading-none",
                  isActive ? "text-white" : "text-slate-800",
                ].join(" ")}
              >
                {count}
              </span>
              <span
                className={[
                  "text-[11px] font-medium whitespace-nowrap",
                  isActive ? "text-indigo-100" : "text-slate-500",
                ].join(" ")}
              >
                {label}
              </span>
              {idx < ORDERED_STAGES.length - 1 && (
                <span
                  aria-hidden="true"
                  className={[
                    "absolute right-0 top-1/2 -translate-y-1/2 translate-x-[55%] z-10",
                    "hidden sm:flex items-center justify-center",
                    "w-4 h-4 rounded-full border text-[9px] font-bold",
                    isActive
                      ? "border-indigo-600 bg-indigo-600 text-white"
                      : "border-slate-200 bg-white text-slate-300",
                  ].join(" ")}
                >
                  ›
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
