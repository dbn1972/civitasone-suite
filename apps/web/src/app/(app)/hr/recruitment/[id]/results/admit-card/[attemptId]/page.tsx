"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useParams } from "next/navigation";
import { formatIndianDateTime } from "@/lib/formatters";
import type { AdmitCard } from "../../resultActions";

type State = { kind: "loading" } | { kind: "error"; blocked: string | null } | { kind: "ready"; card: AdmitCard };

/**
 * GAP-RECRUITMENT-DETAIL-14: printable admit card (hall ticket). The service derives the roll number and the
 * instructions; "Print" uses the browser's print / save-as-PDF, so no PDF renderer is involved.
 */
export default function AdmitCardPage() {
  const t = useTranslations("recruitmentFinish");
  const { id, attemptId } = useParams<{ id: string; attemptId: string }>();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/proxy/v1/hrms/assessments/attempts/${attemptId}/admit-card`, { signal: controller.signal });
        if (!res.ok) {
          const env = (await res.clone().json().catch(() => null)) as { code?: string; message?: string } | null;
          setState({ kind: "error", blocked: env?.code === "ADMIT_CARD_UNAVAILABLE" ? (env.message ?? null) : null });
          return;
        }
        const j = (await res.json()) as { data?: AdmitCard };
        setState(j.data ? { kind: "ready", card: j.data } : { kind: "error", blocked: null });
      } catch (e) {
        if (!(e instanceof Error && e.name === "AbortError")) setState({ kind: "error", blocked: null });
      }
    })();
    return () => controller.abort();
  }, [attemptId]);

  return (
    <div className="page-main" aria-labelledby="ac-heading">
      <p className="print:hidden"><Link href={`/hr/recruitment/${id}/results`} className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">{t("backToResults")}</Link></p>
      {state.kind === "loading" && <p role="status" className="text-sm text-slate-500">{t("acLoading")}</p>}
      {state.kind === "error" && (
        <p role="alert" className="text-sm text-red-600">{state.blocked ? t("acUnavailable", { reason: state.blocked }) : t("acFailed")}</p>
      )}
      {state.kind === "ready" && (
        <article className="mx-auto max-w-2xl rounded-xl border border-slate-300 bg-white p-6 text-slate-900 print:border-0">
          <h1 id="ac-heading" className="text-xl font-bold text-center">{t("acTitle")}</h1>
          <p className="text-center text-sm text-slate-600">{state.card.examination}</p>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <dt className="font-semibold">{t("acRollNumber")}</dt><dd>{state.card.rollNumber}</dd>
            <dt className="font-semibold">{t("acCandidate")}</dt><dd>{state.card.candidateName}</dd>
            {state.card.applicationNo && (<><dt className="font-semibold">{t("acApplicationNo")}</dt><dd>{state.card.applicationNo}</dd></>)}
            <dt className="font-semibold">{t("acMode")}</dt><dd>{state.card.mode}</dd>
            <dt className="font-semibold">{t("acReporting")}</dt><dd>{formatIndianDateTime(state.card.windowStart)}</dd>
            <dt className="font-semibold">{t("acEnds")}</dt><dd>{formatIndianDateTime(state.card.windowEnd)}</dd>
            {state.card.slotLabel && (<><dt className="font-semibold">{t("acSlot")}</dt><dd>{state.card.slotLabel}</dd></>)}
          </dl>
          <h2 className="mt-5 text-sm font-bold">{t("acInstructions")}</h2>
          <ol className="list-decimal ps-5 text-sm text-slate-700">
            {state.card.instructions.map((line) => <li key={line}>{line}</li>)}
          </ol>
          <p className="mt-6 print:hidden">
            <button type="button" onClick={() => window.print()} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">{t("acPrint")}</button>
          </p>
        </article>
      )}
    </div>
  );
}
