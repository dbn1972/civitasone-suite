"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

export type GoiReservationCategory = "sc" | "st" | "obc" | "ph";

/** GFR 2017 prescribed quota percentages, keyed by category -- the single
 * source of truth for both this card's own rendering and any caller that
 * needs to derive real fill data (e.g. recruitment/[id]/page.tsx computes
 * "posts reserved for category X" as pct/100 * totalVacancies, the same way
 * this component does, so the two never drift). */
export const GOI_RESERVATION_QUOTA_PCT: Record<GoiReservationCategory, number> = {
  sc: 15, st: 7.5, obc: 27, ph: 3,
};

interface GOIReservationCardProps {
  totalVacancies: number;
  /** fillPct keyed by quota: 0–100 fill% relative to the quota allocation */
  fill?: Partial<Record<GoiReservationCategory, number>>;
  /**
   * MEDIUM finding: this card used to be rendered with no `fill` prop ever
   * passed, so every category silently showed a hardcoded 0% -- a
   * fabricated figure indistinguishable from a real (if empty) reservation
   * status. The caller now computes `fill` from real application category +
   * stage data (see recruitment/[id]/page.tsx's reservationFill), but that
   * computation is only as honest as the underlying data: when NONE of a
   * vacancy's applications carry a recorded reservation category yet, a
   * computed 0% would look identical to "checked, and it's genuinely zero"
   * -- which it is not. categoryDataAvailable=false renders an explicit
   * "not configured / no data" state instead of a number the system can't
   * actually back. Defaults to true so a caller that HAS real data (the
   * common case) doesn't need to pass it.
   */
  categoryDataAvailable?: boolean;
}

export function GOIReservationCard({ totalVacancies, fill = {}, categoryDataAvailable = true }: GOIReservationCardProps) {
  const t = useTranslations("recruitmentGoiCard");
  const [open, setOpen] = useState(false);

  const GFR_QUOTAS = [
    { key: "sc",  label: "SC",  pct: GOI_RESERVATION_QUOTA_PCT.sc,  color: "var(--info, #3b82f6)", note: t("noteSc") },
    { key: "st",  label: "ST",  pct: GOI_RESERVATION_QUOTA_PCT.st,  color: "var(--violet, #8b5cf6)", note: t("noteSt") },
    { key: "obc", label: "OBC", pct: GOI_RESERVATION_QUOTA_PCT.obc, color: "var(--warn, #f59e0b)", note: t("noteObc") },
    { key: "ph",  label: "PH",  pct: GOI_RESERVATION_QUOTA_PCT.ph,  color: "var(--good, #10b981)", note: t("notePh") },
  ] as const;

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm overflow-hidden mb-6">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full px-5 py-3 flex items-center justify-between text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
      >
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className="text-base">🏛️</span>
          {t("reservationStatus")}
          <span className="text-xs font-normal text-slate-400 dark:text-slate-500 ms-0.5">{t("gfr2017")}</span>
        </span>
        <span
          aria-hidden="true"
          className={[
            "text-slate-400 dark:text-slate-500 transition-transform duration-200 text-sm",
            open ? "rotate-180" : "",
          ].join(" ")}
        >
          ▾
        </span>
      </button>

      {open && (
        <div className="px-5 pb-5 pt-3 border-t border-slate-100 dark:border-slate-700">
          {!categoryDataAvailable ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 italic" role="status">
              {t("noCategoryData")}
            </p>
          ) : (
            <>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                {t("prescribedQuotasFor", { count: totalVacancies })}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {GFR_QUOTAS.map(({ key, label, pct, color, note }) => {
                  const posts = Math.max(1, Math.round((pct / 100) * totalVacancies));
                  const fillPct = fill[key] ?? 0;
                  const filledPosts = Math.round((fillPct / 100) * posts);
                  return (
                    <div key={key}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-300" title={note}>
                          {label}
                        </span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          {pct}%
                          <span className="ms-1 text-slate-400 dark:text-slate-500">·</span>
                          <span className="ms-1">{t("postsCount", { count: posts })}</span>
                          {fillPct > 0 && (
                            <span className="ms-1 text-emerald-600 dark:text-emerald-400 font-medium">
                              · {t("filledCount", { count: filledPosts })}
                            </span>
                          )}
                        </span>
                      </div>
                      {/* Track: quota vs filled */}
                      <div className="relative h-2 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                        {/* Quota band */}
                        <div
                          className="absolute start-0 top-0 h-full rounded-full opacity-25"
                          style={{ width: `${pct}%`, background: color }}
                          aria-hidden="true"
                        />
                        {/* Filled portion */}
                        <div
                          className="absolute start-0 top-0 h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${Math.min(pct, (fillPct / 100) * pct)}%`,
                            background: color,
                          }}
                          aria-hidden="true"
                        />
                      </div>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                        {t("prescribedPercentOfTotal", { pct })}
                      </p>
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-4 border-t border-slate-100 dark:border-slate-700 pt-3">
                {t("footnote")}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
