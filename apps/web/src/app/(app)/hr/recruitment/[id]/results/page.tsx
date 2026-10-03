"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button, ConfirmDialog, StatusPill, useConfirmAction } from "@/app/_components/ds";
import { formatIndianDateTime, humanizeStatus } from "@/lib/formatters";
import { useFormError } from "@/lib/useFormError";
import { attemptsForVacancy, hasNoAttempts, resultActions, type AttemptRow, type ResultStep } from "./resultActions";

type Schedule = { id: string; title: string; status: string; windowStart: string };
type PendingStep = { step: ResultStep; attemptId: string; name: string };

const selectClass = "rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm text-slate-800 dark:text-slate-200";

/**
 * GAP-RECRUITMENT-DETAIL-14: the result lifecycle (consolidate -> freeze -> publish) and admit cards for the
 * applicants of ONE vacancy. The service owns the rules (publish only after freeze; the moderation approver cannot
 * also freeze); a refusal is shown here in plain language.
 */
export default function VacancyResultsPage() {
  const t = useTranslations("recruitmentFinish");
  const { id } = useParams<{ id: string }>();
  const formError = useFormError("assessment result");
  const uid = useId();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [scheduleId, setScheduleId] = useState("");
  const [attempts, setAttempts] = useState<AttemptRow[]>([]);
  const [attemptsFailed, setAttemptsFailed] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, setPending] = useState<PendingStep | null>(null);

  const load = useCallback(async () => {
    try {
      const [apps, sch] = await Promise.all([
        fetch(`/api/proxy/v1/hrms/job-openings/${id}/applications`),
        fetch(`/api/proxy/v1/hrms/assessments/schedules?limit=100`),
      ]);
      if (!apps.ok || !sch.ok) { if (mounted.current) setLoadFailed(true); return; }
      const a = (await apps.json()) as { data?: Array<{ id: string; applicantName: string }> };
      const s = (await sch.json()) as { data?: Schedule[] };
      if (!mounted.current) return;
      setNames(new Map((a.data ?? []).map((x) => [x.id, x.applicantName])));
      setSchedules(s.data ?? []);
      setLoadFailed(false);
    } catch { if (mounted.current) setLoadFailed(true); }
  }, [id]);

  const loadAttempts = useCallback(async (sid: string) => {
    if (!sid) { setAttempts([]); return; }
    try {
      const res = await fetch(`/api/proxy/v1/hrms/assessments/schedules/${sid}`);
      if (!res.ok) { if (mounted.current) setAttemptsFailed(true); return; }
      const j = (await res.json()) as { attempts?: AttemptRow[] };
      if (mounted.current) { setAttempts(j.attempts ?? []); setAttemptsFailed(false); }
    } catch { if (mounted.current) setAttemptsFailed(true); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadAttempts(scheduleId); }, [scheduleId, loadAttempts]);

  const rows = useMemo(() => attemptsForVacancy(attempts, names), [attempts, names]);

  const stepConfirm = useConfirmAction({
    onConfirm: async () => {
      if (!pending) return;
      const res = await fetch(`/api/proxy/v1/hrms/assessments/attempts/${pending.attemptId}/${pending.step}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (!res.ok) {
        const env = (await res.clone().json().catch(() => null)) as { code?: string } | null;
        throw new Error(env?.code === "SOD_VIOLATION" ? t("resSod")
          : env?.code === "NOT_READY" || env?.code === "NOT_FROZEN" || env?.code === "MODERATION_PENDING" || env?.code === "PENDING_EVALUATION" ? t("resNotReady")
          : env?.code === "FORBIDDEN" ? t("selForbidden")
          : (await formError.fromResponse(res, "save")).message);
      }
      setMessage({ kind: "ok", text: t(`resDone_${pending.step}`, { name: pending.name }) });
      await loadAttempts(scheduleId);
      setTimeout(() => { if (mounted.current) void loadAttempts(scheduleId); }, 1200);
    },
    onSuccess: () => setPending(null),
  });

  function ask(step: ResultStep, a: { id: string; name: string }) {
    setMessage(null);
    setPending({ step, attemptId: a.id, name: a.name });
    stepConfirm.trigger();
  }

  return (
    <div className="page-main" aria-labelledby="res-heading">
      <Link href={`/hr/recruitment/${id}`} className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">{t("backToVacancy")}</Link>
      <h1 id="res-heading" className="text-2xl font-bold text-slate-800 dark:text-slate-100 mt-1">{t("resHeading")}</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">{t("resIntro")}</p>

      {message && <p role={message.kind === "error" ? "alert" : "status"} className={`mb-3 text-sm ${message.kind === "error" ? "text-red-600" : "text-emerald-700"}`}>{message.text}</p>}

      {loadFailed ? (
        <p role="alert" className="text-sm text-red-600">{t("resLoadFailed")} <button type="button" className="underline" onClick={() => { setLoadFailed(false); void load(); }}>{t("retry")}</button></p>
      ) : schedules === null ? (
        <p role="status" className="text-sm text-slate-500">{t("resLoading")}</p>
      ) : (
        <>
          <div className="mb-4">
            <label htmlFor={`${uid}-sch`} className="block text-xs font-semibold mb-1">{t("resSchedule")}</label>
            <select id={`${uid}-sch`} className={selectClass} value={scheduleId} onChange={(e) => setScheduleId(e.target.value)}>
              <option value="">{t("resChooseSchedule")}</option>
              {schedules.map((s) => <option key={s.id} value={s.id}>{s.title} · {formatIndianDateTime(s.windowStart)} · {humanizeStatus(s.status)}</option>)}
            </select>
          </div>

          {scheduleId && (attemptsFailed ? (
            <p role="alert" className="text-sm text-red-600">{t("resAttemptsFailed")}</p>
          ) : hasNoAttempts(rows) ? (
            <p className="text-sm text-slate-500">{t("resNoAttempts")}</p>
          ) : (
            <table className="w-full text-sm" aria-label={t("resHeading")}>
              <thead><tr className="text-start text-xs text-slate-500">
                <th scope="col" className="text-start font-medium py-1">{t("resCandidate")}</th>
                <th scope="col" className="text-start font-medium py-1">{t("resStatus")}</th>
                <th scope="col" className="text-start font-medium py-1">{t("resResult")}</th>
                <th scope="col" className="text-start font-medium py-1">{t("resActions")}</th>
              </tr></thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-2 pe-2">{a.name}</td>
                    <td className="py-2 pe-2"><StatusPill status={a.status} /></td>
                    <td className="py-2 pe-2">{a.result}{a.published ? ` · ${t("resPublished")}` : a.frozen ? ` · ${t("resFrozen")}` : ""}</td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-2">
                        <Link href={`/hr/recruitment/${id}/results/admit-card/${a.id}`} className="text-xs text-indigo-600 dark:text-indigo-400 underline self-center" aria-label={t("resAdmitCardFor", { name: a.name })}>{t("resAdmitCard")}</Link>
                        {resultActions(a).map((step) => (
                          <Button key={step} size="sm" variant={step === "publish" ? "primary" : "secondary"} aria-label={t(`resAria_${step}`, { name: a.name })} onClick={() => ask(step, a)}>{t(`resStep_${step}`)}</Button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </>
      )}

      <ConfirmDialog
        open={stepConfirm.open}
        title={pending ? t(`resConfirmTitle_${pending.step}`, { name: pending.name }) : ""}
        description={pending ? t(`resConfirmDescription_${pending.step}`) : undefined}
        confirmLabel={pending ? t(`resStep_${pending.step}`) : undefined}
        danger={pending?.step === "freeze"}
        busy={stepConfirm.busy}
        errorMessage={stepConfirm.error}
        onConfirm={stepConfirm.confirm}
        onCancel={() => { stepConfirm.cancel(); setPending(null); }}
      />
    </div>
  );
}
