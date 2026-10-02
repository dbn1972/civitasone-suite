"use client";

/**
 * APARCycleProgress — GAP-HR-APPRAISALS-02
 *
 * /hr/apar had five stat tiles (Total / Self-Appraisal / Under Review /
 * Awaiting Closure / Finalised) but no single "how far along is this cycle"
 * read. The deleted /hr/appraisals/_components/AppraisalCycleProgress.tsx
 * (see GAP-HR-APPRAISALS-01) had exactly this idea -- a submitted% bar --
 * but it was dead code built against a status vocabulary
 * (pending/in_review/completed) this list never writes, so it could not be
 * revived as-is.
 *
 * Deliberately takes the already server-computed `total` / `finalised`
 * numbers (the same ones the Finalised stat tile already renders) instead
 * of an `AparRecord[]` to re-derive a count from, as the catalogued fix
 * step first suggested: apar/page.tsx's own `apars` array is only the
 * current fetched batch (capped, with a separate `hasMore` flag -- see
 * GAP-HR-APAR-06), so counting off it would silently under-report "x of y"
 * once a tenant has more APARs than one batch -- precisely the bug class
 * GAP-HR-APAR-01 already fixed for the stat tiles themselves. No cycle-
 * end-date field exists anywhere on the API response (verified: this
 * page's own AparListData has no such field), so the days-remaining half
 * of the deleted component is not reinstated -- matching this gap's own
 * fix step 3 ("only add days-remaining if an APAR record/cycle endpoint
 * exposes an end date; otherwise omit").
 *
 * "use client" + useTranslations (not getTranslations) to match the
 * sibling APARFlowCard.tsx in this same directory -- a plain
 * useTranslations() client component receiving only primitive props from
 * the Server Component page, never a function/render-prop crossing that
 * boundary (the bug class GAP-HR-EXPENSES-01 fixed elsewhere).
 */
import { useTranslations } from "next-intl";
import { Card, ProgressBar } from "../../../../_components/ds";

interface APARCycleProgressProps {
  total: number;
  finalised: number;
}

export function APARCycleProgress({ total, finalised }: APARCycleProgressProps) {
  const t = useTranslations("apar");
  if (total <= 0) return null;

  const pct = Math.round((finalised / total) * 100);

  return (
    <Card title={t("cycleProgressTitle")} padding>
      <p style={{ margin: "0 0 10px 0", fontSize: 13, color: "var(--mut)" }}>
        {t("cycleProgressSummary", { finalised, total, pct })}
      </p>
      <div aria-hidden="true">
        <ProgressBar value={pct} />
      </div>
    </Card>
  );
}
