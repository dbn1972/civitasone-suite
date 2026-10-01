import { getTranslations } from "next-intl/server";
import { PageHeader, Card, DataTable, EmptyState, RefreshErrorState, StatGrid, StatCard } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { toHumanError } from "@/lib/messages";
import { formatIndianDate } from "@/lib/formatters";
import { STAGE_LABEL_KEYS } from "@/lib/apar/stages";
import { getSessionName } from "@/lib/auth/roleGuard";
import { AparStageActions, type AparActions } from "./AparStageActions";

type Score = {
  id: string;
  attribute: string;
  weight: string;
  score: string | null;
  remarks: string | null;
} & Record<string, unknown>;

type StageHistory = {
  id: string;
  fromStage: string | null;
  toStage: string;
  actorId: string;
  // GAP-HR-APAR-DETAIL-04: actorRole/override shipped via PR #1694; the
  // actor's NAME (actorName) now comes from the same batchEmployees
  // enrichment as GAP-HR-APAR-DETAIL-02, unblocked the same way (see that
  // gap's comment on the appraisal type below).
  actorRole: string;
  actorName?: string;
  override: boolean;
  remarks: string | null;
  createdAt: string;
} & Record<string, unknown>;

type AparDetail = {
  appraisal: {
    id: string;
    employeeId: string;
    // GAP-HR-APAR-DETAIL-02: employeeName/employeeNo and the three officer
    // names, resolved server-side via the shared batchEmployees helper.
    // The 3-way circular depends_on with GAP-HR-APAR-02/GAP-HR-ADVANCES-01
    // is resolved -- GAP-HR-ADVANCES-01 (PR #1698, merged) proved the
    // helper safe to reuse without ever touching apar/ itself.
    employeeName?: string;
    employeeNo?: string;
    reportingOfficerName?: string;
    reviewingOfficerName?: string;
    acceptingAuthorityName?: string;
    appraisalPeriod: string;
    status: string;
    selfAppraisal: string | null;
    reportingOfficerId: string | null;
    reviewingOfficerId: string | null;
    acceptingAuthorityId: string | null;
    reportingPenPicture: string | null;
    reviewingRemarks: string | null;
    acceptingRemarks: string | null;
    overallGrade: string | null;
    overallBand: string | null;
    disclosedAt: string | null;
    representation: string | null;
    representationDue: string | null;
  };
  scores: Score[];
  history: StageHistory[];
  // GAP-HR-APAR-DETAIL-01: so this page never has to guess stage ownership
  // itself -- see apar/routes.ts's computeAparActions.
  actions: AparActions;
};

async function getApar(id: string): Promise<LoaderResult<AparDetail | null>> {
  return fetchJson<unknown, AparDetail | null>(`/api/v1/hrms/apar/${id}`, null, {
    telemetryKey: "apar.detail",
    mapResponse: (p) => {
      if (!p || typeof p !== "object") return null;
      return p as AparDetail;
    },
  });
}

/**
 * GAP-HR-APAR-DETAIL-05: the DoPT/SPARROW grade bands (engine.ts's
 * bandForGrade), duplicated here as a display-only constant rather than a
 * shared package — this is the only web-side consumer, and the values are
 * a fixed statutory scale, not business logic that changes independently
 * on each side. Keep in sync with services/hrms-service/src/modules/apar/
 * engine.ts's bandForGrade if that scale is ever revised (confirm with HR
 * first — see this GAP's Risk note).
 */
const GRADE_BAND_SCALE = "Outstanding ≥9 · Very Good ≥7 · Good ≥5 · Average ≥4 · else Below Average";

/**
 * GAP-HR-APAR-DETAIL-05: the same weighted-mean formula as the backend's
 * engine.ts computeOverallGrade, so a "provisional" score is available
 * before Accept (when overallGrade is still null) instead of only ever
 * showing the unweighted average scored count divides into.
 */
function provisionalWeightedScore(scores: Score[]): number | null {
  const scored = scores.filter((s) => s.score != null && s.score !== "");
  if (scored.length === 0) return null; // ux-001-ok: `scores` is only reachable past the earlier `if (!detail) return` guard above (source==="error" implies a null detail per the loader contract) -- an empty `scored` array here means no attribute has been scored yet in the workflow (e.g. still at self_pending), never a masked fetch failure
  let weightedSum = 0;
  let totalWeight = 0;
  for (const s of scored) {
    const w = Number(s.weight);
    const weight = Number.isFinite(w) && w > 0 ? w : 1;
    weightedSum += (parseFloat(String(s.score)) || 0) * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 100) / 100 : null;
}

export default async function AparDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const t = await getTranslations("aparDetail");
  const result = await getApar(params.id);
  const detail = result.data;
  // getApar's `empty` sentinel is `null` and mapResponse returns null on any
  // non-object payload, so per fetchJson's contract (apiClient.ts) detail
  // is null if-and-only-if result.source === "error" -- but that's an
  // internal implementation detail of the loader, not something a reader of
  // this page should have to know. Naming it explicitly here means a real
  // fetch error is guaranteed to hit this same early return (and everything
  // below -- including the Scores/History empty-checks -- can assume a
  // genuinely successful load) even if a future change to getApar's default
  // ever breaks the current !detail/error coincidence.
  const errored = result.source === "error";
  // A missing record (the hrms-service GET route throws a real HTTP 404 --
  // see services/hrms-service/src/modules/apar/routes.ts `mustFind`) and
  // every other failure (network error, 5xx, bad payload, missing
  // auth/config) both collapse to the same `source: "error"` above --
  // `fetchJson`'s optional `status` is what still lets this page tell them
  // apart (UX-009 follow-up), so a clerk only ever sees "this record doesn't
  // exist" when that's actually true, and a retryable "couldn't load" for a
  // genuine transient failure instead of a dead-end "not found".
  const isNotFound = errored && result.status === 404;

  if (errored && !isNotFound) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title={t("detailPageTitle")} subtitle={t("loadErrorSubtitle")} back="/hr/apar" backLabel="Back to APAR" />
        <DataSourceBadge source={result.source} />
        <Card title="">
          <RefreshErrorState error={toHumanError("load", { area: "APAR record" })} backHref="/hr/apar" />
        </Card>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title={t("detailPageTitle")} subtitle={t("notFoundSubtitle")} back="/hr/apar" backLabel="Back to APAR" />
        <DataSourceBadge source={result.source} />
        <Card title="">
          <EmptyState icon="📋" title={t("notFoundEmptyTitle")} message={t("notFoundEmptyMessage")} />
        </Card>
      </div>
    );
  }

  const { appraisal, scores, history, actions } = detail;
  const stageLabelKeyForStatus = STAGE_LABEL_KEYS[appraisal.status as keyof typeof STAGE_LABEL_KEYS];
  const stageLabel = stageLabelKeyForStatus ? t(stageLabelKeyForStatus) : appraisal.status;
  const scoredCount = scores.filter((s) => !!s.score).length;
  const avgScore = scoredCount > 0
    ? (scores.reduce((sum, s) => sum + (parseFloat(String(s.score ?? "0")) || 0), 0) / scoredCount).toFixed(1)
    : "—";
  // GAP-HR-APAR-DETAIL-05: distinct from the plain average above — this is
  // the same weighted formula the backend uses at Accept time, so HR can
  // see a realistic provisional figure before that stage is reached. Once
  // overallGrade exists (post-Accept) that server-computed, audited value
  // is shown instead — this provisional figure is only ever a preview.
  const provisionalScore = appraisal.overallGrade == null ? provisionalWeightedScore(scores) : null;
  const viewerName = getSessionName();

  const SCORE_COLS = [
    { key: "attribute" as const, label: t("colAttribute") },
    { key: "weight" as const,    label: t("colWeight") },
    { key: "score" as const,     label: t("colScore") },
    { key: "remarks" as const,   label: t("colRemarks") },
  ];

  // GAP-HR-APAR-DETAIL-04: DataTable columns can only read a plain field off
  // each row (a Server Component page cannot hand it a `render:` function —
  // see ds/DataTable.tsx's Column<T> doc comment for the exact crash class
  // that guards against), so the Override indicator is precomputed into the
  // row data itself rather than derived at render time.
  const historyRows = history.map((h) => ({
    ...h,
    overrideLabel: h.override ? t("overrideYes") : "",
  }));

  // GAP-HR-APAR-DETAIL-04: never a raw actor UUID -- a plain '—' when this
  // tenant's directory has no name for that id, same fallback convention as
  // the appraisal-level names below.
  const historyRowsWithActorName = historyRows.map((h) => ({ ...h, actorName: h.actorName ?? "—" }));

  const HISTORY_COLS = [
    { key: "toStage" as const,      label: t("colStage"), cellType: "status" as const },
    { key: "actorName" as const,    label: t("colActor") },
    { key: "actorRole" as const,    label: t("colActorRole") },
    { key: "overrideLabel" as const, label: t("colOverride") },
    { key: "remarks" as const,      label: t("colRemarks") },
    { key: "createdAt" as const,    label: t("colAt"), cellType: "datetime" as const },
  ];

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      {/* GAP-HR-APAR-DETAIL-07 (DPDP): this print-only block is invisible on
          screen and only rendered by the browser's print stylesheet, so a
          printed/PDF'd copy of a statutory confidential report always
          carries who printed it and when — independent of anything the
          printing app itself adds. */}
      <div className="apar-print-only" aria-hidden="true">
        {t("printedByLine", { name: viewerName ?? "—", date: formatIndianDate(new Date().toISOString()) })}
      </div>
      <style>{`
        .apar-print-only { display: none; }
        @media print {
          .apar-print-only {
            display: block;
            font-size: 11px;
            color: #000;
            border-bottom: 1px solid #000;
            padding-bottom: 6px;
            margin-bottom: 12px;
          }
        }
      `}</style>

      <PageHeader
        title={t("titleWithPeriod", { period: appraisal.appraisalPeriod })}
        subtitle={t("subtitleEmployeeStage", {
          employeeName: appraisal.employeeName
            ? (appraisal.employeeNo ? `${appraisal.employeeName} (${appraisal.employeeNo})` : appraisal.employeeName)
            : "—",
          stageLabel,
        })}
        back="/hr/apar" backLabel="Back to APAR"
      />
      <DataSourceBadge source={result.source} />

      {/* GAP-HR-APAR-DETAIL-07 (DPDP): APAR carries statutory confidential
          performance data (pen-picture, officer remarks, grade) — this
          banner marks that on screen, not just via the API's own read-scope
          enforcement (which stays the real access boundary). */}
      <div
        role="note"
        style={{
          margin: "12px 0", padding: "10px 14px", borderRadius: 8,
          background: "var(--warnbg, #fffbeb)", border: "1px solid var(--warn, #b45309)",
          color: "var(--warn, #92400e)", fontSize: 13, fontWeight: 600,
        }}
      >
        🔒 {t("confidentialBanner")}
      </div>

      <StatGrid>
        <StatCard icon="\U0001f4cb" iconBg="var(--infobg, #e6f0ff)" label={t("statTotalCriteria")} value={scores.length} />
        <StatCard icon="✅"       iconBg="var(--goodbg, #e6f7f0)" label={t("statScored")}         value={scoredCount} />
        <StatCard
          icon="\U0001f4ca" iconBg="var(--warnbg, #fff7e6)"
          label={provisionalScore !== null ? t("statProvisionalScore") : t("statAvgScore")}
          value={provisionalScore !== null ? provisionalScore.toFixed(1) : avgScore}
        />
        <StatCard icon="\U0001f4dc" iconBg="var(--bg, #f5f5f5)" label={t("statStageChanges")}  value={history.length} />
      </StatGrid>

      <Card title={t("appraisalDetailsTitle")}>
        <div style={{ padding: "16px 20px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 24px", fontSize: 14 }}>
          <div><span style={{ color: "var(--mut)", marginInlineEnd: 8 }}>{t("periodLabel")}</span><strong>{appraisal.appraisalPeriod}</strong></div>
          <div><span style={{ color: "var(--mut)", marginInlineEnd: 8 }}>{t("currentStageLabel")}</span><strong>{stageLabel}</strong></div>
          <div>
            <span style={{ color: "var(--mut)", marginInlineEnd: 8 }}>{t("gradeLabel")}</span>
            <strong>{appraisal.overallGrade ?? "—"}</strong>
            <span style={{ marginInlineStart: 8, fontSize: 11, color: "var(--mut)" }} title={GRADE_BAND_SCALE}>
              ({GRADE_BAND_SCALE})
            </span>
          </div>
          {appraisal.overallBand && <div><span style={{ color: "var(--mut)", marginInlineEnd: 8 }}>{t("bandLabel")}</span><strong>{appraisal.overallBand}</strong></div>}
          {/* GAP-HR-APAR-DETAIL-02: names, never the raw UUID; '—' when this
              tenant's directory has no name for the id. */}
          {appraisal.reportingOfficerId && <div><span style={{ color: "var(--mut)", marginInlineEnd: 8 }}>{t("reportingOfficerLabel")}</span>{appraisal.reportingOfficerName ?? "—"}</div>}
          {appraisal.reviewingOfficerId && <div><span style={{ color: "var(--mut)", marginInlineEnd: 8 }}>{t("reviewingOfficerLabel")}</span>{appraisal.reviewingOfficerName ?? "—"}</div>}
          {appraisal.acceptingAuthorityId && <div><span style={{ color: "var(--mut)", marginInlineEnd: 8 }}>{t("acceptingAuthorityLabel")}</span>{appraisal.acceptingAuthorityName ?? "—"}</div>}
          {appraisal.disclosedAt && <div><span style={{ color: "var(--mut)", marginInlineEnd: 8 }}>{t("disclosedAtLabel")}</span>{formatIndianDate(appraisal.disclosedAt)}</div>}
          {appraisal.representationDue && <div><span style={{ color: "var(--mut)", marginInlineEnd: 8 }}>{t("representationDueLabel")}</span>{formatIndianDate(appraisal.representationDue)}</div>}
        </div>
        {appraisal.selfAppraisal && (
          <div style={{ padding: "0 20px 16px" }}>
            <p style={{ color: "var(--mut)", fontSize: 12, marginBottom: 4 }}>{t("selfAppraisalLabel")}</p>
            <p style={{ fontSize: 14 }}>{appraisal.selfAppraisal}</p>
          </div>
        )}
        {appraisal.reportingPenPicture && (
          <div style={{ padding: "0 20px 16px" }}>
            <p style={{ color: "var(--mut)", fontSize: 12, marginBottom: 4 }}>{t("reportingPenPictureLabel")}</p>
            <p style={{ fontSize: 14 }}>{appraisal.reportingPenPicture}</p>
          </div>
        )}
        {/* GAP-HR-APAR-DETAIL-03: previously fetched by the API but never
            rendered anywhere on this page. The API itself now omits both
            fields from the appraisee's own pre-disclosure view (see
            services/hrms-service/.../apar/routes.ts's
            redactForAppraiseePreDisclosure), so simply rendering "if
            present" is correct here — no extra client-side gating needed. */}
        {appraisal.reviewingRemarks && (
          <div style={{ padding: "0 20px 16px" }}>
            <p style={{ color: "var(--mut)", fontSize: 12, marginBottom: 4 }}>{t("reviewingRemarksLabel")}</p>
            <p style={{ fontSize: 14 }}>{appraisal.reviewingRemarks}</p>
          </div>
        )}
        {appraisal.acceptingRemarks && (
          <div style={{ padding: "0 20px 16px" }}>
            <p style={{ color: "var(--mut)", fontSize: 12, marginBottom: 4 }}>{t("acceptingRemarksLabel")}</p>
            <p style={{ fontSize: 14 }}>{appraisal.acceptingRemarks}</p>
          </div>
        )}
        {appraisal.representation && (
          <div style={{ padding: "0 20px 16px" }}>
            <p style={{ color: "var(--mut)", fontSize: 12, marginBottom: 4 }}>{t("officerRepresentationLabel")}</p>
            <p style={{ fontSize: 14 }}>{appraisal.representation}</p>
          </div>
        )}
      </Card>

      <div style={{ marginTop: 16 }}>
      <Card title={t("scoresByAttributeTitle")}>
        {scores.length === 0 ? (
          <EmptyState icon="📊" title={t("noScoresTitle")} message={t("noScoresMessage")} />
        ) : (
          <DataTable<Score>
            columns={SCORE_COLS}
            rows={scores}
            sortable
            filterable
            emptyIcon="📊"
            emptyTitle={t("noScoresTitle")}
            emptyMessage={t("noScoresMessage")}
          />
        )}
      </Card>
      </div>

      <div style={{ marginTop: 16 }}>
      <Card title={t("stageHistoryTitle")}>
        {history.length === 0 ? (
          <EmptyState icon="🕓" title={t("noHistoryTitle")} message={t("noHistoryMessage")} />
        ) : (
          <DataTable<StageHistory & { overrideLabel: string; actorName: string }>
            columns={HISTORY_COLS}
            rows={historyRowsWithActorName}
            sortable
            filterable
            emptyIcon="🕓"
            emptyTitle={t("noHistoryTitle")}
            emptyMessage={t("noHistoryMessage")}
          />
        )}
      </Card>
      </div>

      {/* GAP-HR-APAR-DETAIL-01: the six backend stage-transition routes
          (self-appraisal/reporting/reviewing/accept/representation/
          finalise) previously had no web caller at all -- this page only
          ever showed the static notice below, so the core APAR workflow
          could not be performed from the UI. `actions` (computed
          server-side by apar/routes.ts's computeAparActions, never guessed
          here) says whether THIS viewer can act right now; the read-only
          notice is kept as the fallback for everyone else (an unrelated
          viewer, or a genuinely closed/finalised record). */}
      {actions.canAct || actions.canFinalise ? (
        <div style={{ marginTop: 16 }}>
          <AparStageActions appraisalId={appraisal.id} status={appraisal.status} actions={actions} />
        </div>
      ) : (
        <div style={{ marginTop: 16, padding: "12px 20px", background: "var(--bg2)", borderRadius: 8, fontSize: 13, color: "var(--mut)" }}>
          {t("workflowNoticeLine1")}
          {" "}
          {t("workflowNoticeLine2")}
        </div>
      )}
    </div>
  );
}
