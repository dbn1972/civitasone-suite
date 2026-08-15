"use client";

import { useState } from "react";

const GFR_QUOTAS = [
  { key: "sc",  label: "SC",  pct: 15,  color: "#3b82f6", note: "Scheduled Caste" },
  { key: "st",  label: "ST",  pct: 7.5, color: "#8b5cf6", note: "Scheduled Tribe" },
  { key: "obc", label: "OBC", pct: 27,  color: "#f59e0b", note: "Other Backward Classes" },
  { key: "ph",  label: "PH",  pct: 3,   color: "#10b981", note: "Persons with Disability" },
] as const;

interface GOIReservationCardProps {
  totalVacancies: number;
  /** fillPct keyed by quota: 0–100 fill% relative to the quota allocation */
  fill?: Partial<Record<"sc" | "st" | "obc" | "ph", number>>;
}

export function GOIReservationCard({ totalVacancies, fill = {} }: GOIReservationCardProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden mb-6">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full px-5 py-3 flex items-center justify-between text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
      >
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className="text-base">🏛️</span>
          Reservation Status
          <span className="text-xs font-normal text-slate-400 ml-0.5">(GFR 2017)</span>
        </span>
        <span
          aria-hidden="true"
          className={[
            "text-slate-400 transition-transform duration-200 text-sm",
            open ? "rotate-180" : "",
          ].join(" ")}
        >
          ▾
        </span>
      </button>

      {open && (
        <div className="px-5 pb-5 pt-3 border-t border-slate-100">
          <p className="text-xs text-slate-500 mb-4">
            Prescribed quotas for{" "}
            <span className="font-semibold text-slate-700">{totalVacancies}</span>{" "}
            post{totalVacancies !== 1 ? "s" : ""} per GOI reservation policy (GFR 2017 / DoPT OM).
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {GFR_QUOTAS.map(({ key, label, pct, color, note }) => {
              const posts = Math.max(1, Math.round((pct / 100) * totalVacancies));
              const fillPct = fill[key] ?? 0;
              const filledPosts = Math.round((fillPct / 100) * posts);
              return (
                <div key={key}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-slate-700" title={note}>
                      {label}
                    </span>
                    <span className="text-xs text-slate-500">
                      {pct}%
                      <span className="ml-1 text-slate-400">·</span>
                      <span className="ml-1">{posts} post{posts !== 1 ? "s" : ""}</span>
                      {fillPct > 0 && (
                        <span className="ml-1 text-emerald-600 font-medium">
                          · {filledPosts} filled
                        </span>
                      )}
                    </span>
                  </div>
                  {/* Track: quota vs filled */}
                  <div className="relative h-2 rounded-full bg-slate-100 overflow-hidden">
                    {/* Quota band */}
                    <div
                      className="absolute left-0 top-0 h-full rounded-full opacity-25"
                      style={{ width: `${pct}%`, background: color }}
                      aria-hidden="true"
                    />
                    {/* Filled portion */}
                    <div
                      className="absolute left-0 top-0 h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.min(pct, (fillPct / 100) * pct)}%`,
                        background: color,
                      }}
                      aria-hidden="true"
                    />
                  </div>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    Prescribed: {pct}% of total posts
                  </p>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-slate-400 mt-4 border-t border-slate-100 pt-3">
            * Reservation percentages as per DoPT policy. Actual allocations subject to roaster maintenance and horizontal/vertical reservation rules.
          </p>
        </div>
      )}
    </div>
  );
}
