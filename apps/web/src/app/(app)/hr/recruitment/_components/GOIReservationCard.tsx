"use client";

import { useCallback, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";

import {
  ROSTER_CATEGORIES, GOI_RESERVATION_QUOTA_PCT, HORIZONTAL_CATEGORIES, categoryOfApplication, horizontalDraftErrors,
  type RosterCategory, type GoiReservationCategory, type HorizontalCategory,
} from "./reservationCategories";
import { ReservationShortlistPanel } from "./ReservationShortlistPanel";
import type { ShortlistCandidate } from "./reservationShortlist";

// Re-exported so existing imports from this module keep working.
export { ROSTER_CATEGORIES, GOI_RESERVATION_QUOTA_PCT, categoryOfApplication };
export type { RosterCategory, GoiReservationCategory };

type Roster = {
  status: string;
  totalVacancies: number;
  categoryVacancies: Record<string, number>;
  /** Horizontal reservations (PwBD / ex-servicemen / women); absent on rosters saved before they existed. */
  horizontalVacancies?: Record<string, number>;
};

interface GOIReservationCardProps {
  jobOpeningId: string;
  totalVacancies: number;
  /** Hired applicants per roster category, from real application category + stage data. */
  hiredByCategory?: Partial<Record<RosterCategory, number>>;
  /**
   * false when no application carries a recorded category yet (or the load
   * failed): fill figures are then withheld instead of showing a fabricated 0.
   */
  categoryDataAvailable?: boolean;
  /**
   * Screened-eligible applications for the reservation shortlist (offered once the roster is approved).
   * Omit (e.g. in blind-screening mode, where categories are withheld) to hide the shortlist panel.
   */
  candidates?: readonly ShortlistCandidate[];
}

const COLORS: Record<RosterCategory, string> = {
  UR: "var(--ink2, #64748b)",
  SC: "var(--info, #3b82f6)",
  ST: "var(--violet, #8b5cf6)",
  OBC: "var(--warn, #f59e0b)",
  EWS: "var(--good, #10b981)",
};

export function GOIReservationCard({ jobOpeningId, totalVacancies, hiredByCategory = {}, categoryDataAvailable = true, candidates }: GOIReservationCardProps) {
  const t = useTranslations("recruitmentGoiCard");
  const formError = useFormError("reservation roster");
  const [open, setOpen] = useState(false);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "none" | "error" | "ready">("idle");
  const [roster, setRoster] = useState<Roster | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<RosterCategory, string>>({ UR: "", SC: "", ST: "", OBC: "", EWS: "" });
  const [hDraft, setHDraft] = useState<Record<HorizontalCategory, string>>({ PWBD: "", EXSM: "", WOMEN: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const formId = useId();

  const loadRoster = useCallback(async () => {
    setLoadState("loading");
    try {
      const res = await fetch(`/api/proxy/v1/hrms/job-openings/${jobOpeningId}/reservation-roster`);
      if (res.status === 404) { setRoster(null); setLoadState("none"); return; }
      if (!res.ok) { setLoadState("error"); return; }
      setRoster(await res.json() as Roster);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }, [jobOpeningId]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && loadState === "idle") void loadRoster();
  }

  function startEditing() {
    const base: Record<RosterCategory, string> = { UR: "", SC: "", ST: "", OBC: "", EWS: "" };
    for (const c of ROSTER_CATEGORIES) {
      const n = roster?.categoryVacancies?.[c];
      base[c] = n != null ? String(n) : roster ? "0" : "";
    }
    setDraft(base);
    const h: Record<HorizontalCategory, string> = { PWBD: "", EXSM: "", WOMEN: "" };
    for (const k of HORIZONTAL_CATEGORIES) {
      const n = roster?.horizontalVacancies?.[k];
      h[k] = n != null ? String(n) : "";
    }
    setHDraft(h);
    setMessage(null);
    setEditing(true);
  }

  const draftNumbers = ROSTER_CATEGORIES.map((c) => (draft[c].trim() === "" ? 0 : Number(draft[c])));
  const draftValid = draftNumbers.every((n) => Number.isInteger(n) && n >= 0);
  const draftSum = draftNumbers.reduce((a, b) => a + b, 0);
  const hErrors = horizontalDraftErrors(hDraft, totalVacancies);
  const draftMatchesTotal = draftValid && draftSum === totalVacancies && hErrors.length === 0;

  async function saveRoster(e: React.FormEvent) {
    e.preventDefault();
    if (!draftMatchesTotal) return;
    setBusy(true);
    setMessage(null);
    try {
      const categoryVacancies = Object.fromEntries(ROSTER_CATEGORIES.map((c, i) => [c, draftNumbers[i]]));
      const res = await fetch(`/api/proxy/v1/hrms/job-openings/${jobOpeningId}/reservation-roster`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          totalVacancies, categoryVacancies,
          horizontalVacancies: Object.fromEntries(HORIZONTAL_CATEGORIES.filter((k) => hDraft[k].trim() !== "").map((k) => [k, Number(hDraft[k])])),
        }),
      });
      if (!res.ok) {
        setMessage({ kind: "error", text: (await formError.fromResponse(res, "save")).message });
        return;
      }
      setEditing(false);
      setMessage({ kind: "ok", text: t("rosterSaved") });
      await loadRoster();
    } catch {
      setMessage({ kind: "error", text: formError.fromException("save").message });
    } finally {
      setBusy(false);
    }
  }

  async function approveRoster() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/proxy/v1/hrms/job-openings/${jobOpeningId}/reservation-roster/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!res.ok) {
        const env = await res.clone().json().catch(() => null) as { code?: string } | null;
        if (env?.code === "SOD_VIOLATION") {
          setMessage({ kind: "error", text: t("sodViolation") });
        } else {
          setMessage({ kind: "error", text: (await formError.fromResponse(res, "save")).message });
        }
        return;
      }
      setMessage({ kind: "ok", text: t("rosterApproved") });
      await loadRoster();
    } catch {
      setMessage({ kind: "error", text: formError.fromException("save").message });
    } finally {
      setBusy(false);
    }
  }

  const sanctioned = loadState === "ready" && roster !== null;
  const rows = ROSTER_CATEGORIES
    .map((key) => {
      const guidancePct = key === "UR" ? null : GOI_RESERVATION_QUOTA_PCT[key.toLowerCase() as GoiReservationCategory];
      const posts = sanctioned
        ? roster!.categoryVacancies?.[key] ?? 0
        : guidancePct === null ? null : Math.max(1, Math.round((guidancePct / 100) * totalVacancies));
      return { key, posts, guidancePct };
    })
    // Without a sanctioned roster only the statutory reserved categories have a guidance figure to show.
    .filter((r) => r.posts !== null);

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm overflow-hidden mb-6">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="w-full px-5 py-3 flex items-center justify-between text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
      >
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className="text-base">🏛️</span>
          {t("reservationStatus")}
          <span className="text-xs font-normal text-slate-400 dark:text-slate-500 ms-0.5">{t("gfr2017")}</span>
          {sanctioned && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${roster!.status === "approved" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
              {roster!.status === "approved" ? t("statusApproved") : t("statusDraft")}
            </span>
          )}
        </span>
        <span aria-hidden="true" className={["text-slate-400 dark:text-slate-500 transition-transform duration-200 text-sm", open ? "rotate-180" : ""].join(" ")}>▾</span>
      </button>

      {open && (
        <div className="px-5 pb-5 pt-3 border-t border-slate-100 dark:border-slate-700">
          {loadState === "loading" && <p className="text-xs text-slate-500" role="status">{t("loadingRoster")}</p>}
          {loadState === "error" && (
            <p className="text-xs text-red-600" role="alert">
              {t("rosterLoadError")}{" "}
              <button type="button" className="underline" onClick={() => void loadRoster()}>{t("retry")}</button>
            </p>
          )}

          {(loadState === "none" || loadState === "ready") && (
            <>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                {sanctioned
                  ? t("sanctionedRosterFor", { count: totalVacancies })
                  : t("noRosterGuidance", { count: totalVacancies })}
              </p>

              {!sanctioned || categoryDataAvailable ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {rows.map(({ key, posts, guidancePct }) => {
                    const hired = hiredByCategory[key] ?? 0;
                    const total = posts ?? 0;
                    const fillPct = total > 0 ? Math.min(100, (hired / total) * 100) : 0;
                    return (
                      <div key={key}>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-bold text-slate-700 dark:text-slate-300" title={t(`note${key.charAt(0)}${key.slice(1).toLowerCase()}`)}>{key}</span>
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            {sanctioned ? null : <>{guidancePct}%<span className="ms-1 text-slate-400">·</span></>}
                            <span className="ms-1">{t("postsCount", { count: total })}</span>
                            {categoryDataAvailable && hired > 0 && (
                              <span className="ms-1 text-emerald-600 dark:text-emerald-400 font-medium">· {t("filledCount", { count: hired })}</span>
                            )}
                          </span>
                        </div>
                        <div className="relative h-2 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                          <div className="absolute start-0 top-0 h-full rounded-full opacity-25" style={{ width: "100%", background: COLORS[key] }} aria-hidden="true" />
                          <div className="absolute start-0 top-0 h-full rounded-full transition-all duration-500" style={{ width: `${categoryDataAvailable ? fillPct : 0}%`, background: COLORS[key] }} aria-hidden="true" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-slate-500 dark:text-slate-400 italic" role="status">{t("noCategoryData")}</p>
              )}

              {!sanctioned && <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-3" role="status">{t("guidanceOnly")}</p>}

              {message && (
                <p role={message.kind === "error" ? "alert" : "status"} className={`mt-3 text-xs ${message.kind === "error" ? "text-red-600" : "text-emerald-700"}`}>{message.text}</p>
              )}

              {editing ? (
                <form onSubmit={saveRoster} className="mt-4 grid gap-3" aria-label={t("setRoster")}>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    {ROSTER_CATEGORIES.map((c) => (
                      <div key={c}>
                        <label htmlFor={`${formId}-${c}`} className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">{t("rosterFieldLabel", { category: c })}</label>
                        <input
                          id={`${formId}-${c}`}
                          type="number" min={0} step={1} inputMode="numeric"
                          value={draft[c]}
                          onChange={(e) => setDraft((d) => ({ ...d, [c]: e.target.value }))}
                          className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm"
                        />
                      </div>
                    ))}
                  </div>
                  <fieldset className="grid grid-cols-3 gap-3">
                    <legend className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">{t("horizontalLegend")}</legend>
                    {HORIZONTAL_CATEGORIES.map((k) => (
                      <div key={k}>
                        <label htmlFor={`${formId}-h-${k}`} className="block text-xs text-slate-600 dark:text-slate-300 mb-1">{t(`horizontal_${k}`)}</label>
                        <input
                          id={`${formId}-h-${k}`} type="number" min={0} max={totalVacancies} step={1} inputMode="numeric"
                          value={hDraft[k]} aria-invalid={hErrors.includes(k)}
                          onChange={(e) => setHDraft((d) => ({ ...d, [k]: e.target.value }))}
                          className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm"
                        />
                      </div>
                    ))}
                    <p className="col-span-3 text-[11px] text-slate-500">{t("horizontalHelp")}</p>
                  </fieldset>
                  <p className={`text-xs ${draftMatchesTotal ? "text-slate-500" : "text-red-600"}`} role="status">
                    {t("rosterSum", { sum: draftSum, total: totalVacancies })}
                  </p>
                  <div className="flex gap-2">
                    <button type="submit" disabled={busy || !draftMatchesTotal} className="rounded-lg bg-indigo-600 text-white px-3 py-1.5 text-xs font-semibold disabled:opacity-50">
                      {busy ? t("saving") : t("saveRoster")}
                    </button>
                    <button type="button" disabled={busy} onClick={() => setEditing(false)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold">{t("cancel")}</button>
                  </div>
                </form>
              ) : (
                <div className="mt-4 flex flex-wrap gap-2">
                  {(!sanctioned || roster!.status !== "approved") && (
                    <button type="button" onClick={startEditing} disabled={busy} className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-xs font-semibold">
                      {sanctioned ? t("editRoster") : t("setRoster")}
                    </button>
                  )}
                  {sanctioned && roster!.status === "draft" && (
                    <button type="button" onClick={() => void approveRoster()} disabled={busy} className="rounded-lg bg-emerald-600 text-white px-3 py-1.5 text-xs font-semibold disabled:opacity-50">
                      {busy ? t("saving") : t("approveRoster")}
                    </button>
                  )}
                </div>
              )}

              {sanctioned && Object.keys(roster!.horizontalVacancies ?? {}).length > 0 && (
                <p className="mt-3 text-xs text-slate-600 dark:text-slate-300">
                  {t("horizontalSummary", { list: HORIZONTAL_CATEGORIES.filter((k) => roster!.horizontalVacancies?.[k] != null).map((k) => `${t(`horizontal_${k}`)} ${roster!.horizontalVacancies![k]}`).join(" · ") })}
                </p>
              )}

              {sanctioned && roster!.status === "approved" && candidates && (
                <ReservationShortlistPanel jobOpeningId={jobOpeningId} candidates={candidates} />
              )}

              <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-4 border-t border-slate-100 dark:border-slate-700 pt-3">{t("footnote")}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
