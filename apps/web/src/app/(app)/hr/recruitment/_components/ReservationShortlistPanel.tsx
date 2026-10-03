"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { buildShortlistRequest, rowProblem, toRows, type ShortlistCandidate } from "./reservationShortlist";

type Allocation = { applicationId: string; category: string; allocatedAgainst: string; rank: number };
type Waitlisted = { applicationId: string; category: string; rank: number };
type Result = { mode: string; selected: Allocation[]; waitlist: Waitlisted[]; filled: Record<string, number> };

/**
 * GAP-RECRUITMENT-DETAIL-03: calls the service's reservation-shortlist (meritorious-reserved rule against the
 * APPROVED roster) for the screened-eligible pool. HR supplies each candidate's merit score. The result is
 * advisory and not stored: the frozen list is recorded through a selection list (Selection lists page).
 */
export function ReservationShortlistPanel({ jobOpeningId, candidates }: { jobOpeningId: string; candidates: readonly ShortlistCandidate[] }) {
  const t = useTranslations("recruitmentFinish");
  const formError = useFormError("reservation shortlist");
  const [scores, setScores] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rows = toRows(candidates, scores);
  const label = (id: string) => candidates.find((c) => c.id === id)?.label ?? id.slice(0, 8);

  async function compute(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    const built = buildShortlistRequest(rows);
    if (!built.ok) { setError(built.problems.length > 0 ? t("shortlistFixRows") : t("shortlistNoCandidates")); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/proxy/v1/hrms/job-openings/${jobOpeningId}/reservation-shortlist`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(built.body),
      });
      if (!res.ok) {
        const env = (await res.clone().json().catch(() => null)) as { code?: string } | null;
        setError(env?.code === "ROSTER_NOT_APPROVED" ? t("shortlistRosterNotApproved")
          : env?.code === "UNMAPPED_CATEGORY" ? t("shortlistUnmapped")
          : (await formError.fromResponse(res, "save")).message);
        return;
      }
      setResult((await res.json()) as Result);
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-4 border-t border-slate-100 dark:border-slate-700 pt-3" aria-label={t("shortlistTitle")}>
      <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300">{t("shortlistTitle")}</h3>
      <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2">{t("shortlistIntro")}</p>
      {candidates.length === 0 ? (
        <p className="text-xs text-slate-500 italic">{t("shortlistNoCandidates")}</p>
      ) : (
        <form onSubmit={compute} className="flex flex-col gap-2">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-start text-slate-500">
                <th scope="col" className="text-start font-medium py-1">{t("shortlistCandidate")}</th>
                <th scope="col" className="text-start font-medium py-1">{t("shortlistCategory")}</th>
                <th scope="col" className="text-start font-medium py-1">{t("shortlistScore")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const problem = rowProblem(r);
                return (
                  <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-1 pe-2">{r.label}</td>
                    <td className="py-1 pe-2">{r.normalised ?? <span className="text-red-600">{problem === "no_category" ? t("shortlistNoCategory") : t("shortlistUnmappedCategory", { category: r.category ?? "" })}</span>}</td>
                    <td className="py-1">
                      <input
                        aria-label={t("shortlistScoreFor", { name: r.label })}
                        type="number" step="any" min={0} inputMode="decimal"
                        value={r.score}
                        onChange={(e) => setScores((s) => ({ ...s, [r.id]: e.target.value }))}
                        className="w-24 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-gray-900 px-2 py-1"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div><button type="submit" disabled={busy} className="rounded-lg bg-indigo-600 text-white px-3 py-1.5 text-xs font-semibold disabled:opacity-50">{busy ? t("saving") : t("shortlistCompute")}</button></div>
        </form>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
      {result && (
        <div className="mt-3 text-xs" role="status">
          <p className="font-semibold">{t("shortlistSelected", { count: result.selected.length })}</p>
          <ol className="list-decimal ps-5">
            {result.selected.map((s) => (
              <li key={s.applicationId}>{label(s.applicationId)} · {s.category}{s.allocatedAgainst !== s.category ? ` ${t("shortlistOnMerit")}` : ""} → {s.allocatedAgainst} #{s.rank}</li>
            ))}
          </ol>
          {result.waitlist.length > 0 && (
            <>
              <p className="mt-2 font-semibold">{t("shortlistWaitlist", { count: result.waitlist.length })}</p>
              <ol className="list-decimal ps-5">
                {result.waitlist.map((w) => <li key={w.applicationId}>{label(w.applicationId)} · {w.category} #{w.rank}</li>)}
              </ol>
            </>
          )}
          <p className="mt-2 text-slate-500">{t("shortlistAdvisory")}</p>
        </div>
      )}
    </section>
  );
}
