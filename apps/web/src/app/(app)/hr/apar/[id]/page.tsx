import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader, Card, DataTable, EmptyState, RefreshErrorState, StatGrid, StatCard } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { toHumanError } from "@/lib/messages";

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
  remarks: string | null;
  createdAt: string;
} & Record<string, unknown>;

type AparDetail = {
  appraisal: {
    id: string;
    employeeId: string;
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

// UX-017: stage labels are looked up by key through t() at render time so
// they stay in the active locale — the record's `status` is the lookup key,
// not display text itself.
const STAGE_LABEL_KEYS: Record<string, string> = {
  self_pending:        "stageSelfPending",
  reporting_officer:   "stageReportingOfficer",
  reviewing_officer:   "stageReviewingOfficer",
  accepting_authority: "stageAcceptingAuthority",
  disclosed:           "stageDisclosed",
  representation:      "stageRepresentation",
  finalised:           "stageFinalised",
};

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
      <main className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title={t("detailPageTitle")} subtitle={t("loadErrorSubtitle")} back="/hr/apar" backLabel="Back to APAR" />
        <DataSourceBadge source={result.source} />
        <Card title="">
          <RefreshErrorState error={toHumanError("load", { area: "APAR record" })} backHref="/hr/apar" />
        </Card>
      </main>
    );
  }

  if (!detail) {
    return (
      <main className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title={t("detailPageTitle")} subtitle={t("notFoundSubtitle")} back="/hr/apar" backLabel="Back to APAR" />
        <DataSourceBadge source={result.source} />
        <Card title="">
          <EmptyState icon="📋" title={t("notFoundEmptyTitle")} message={t("notFoundEmptyMessage")} />
        </Card>
      </main>
    );
  }

  const { appraisal, scores, history } = detail;
  const stageLabelKey = STAGE_LABEL_KEYS[appraisal.status];
  const stageLabel  = stageLabelKey ? t(stageLabelKey) : appraisal.status;
  const scoredCount = scores.filter((s) => !!s.score).length;
  const avgScore    = scoredCount > 0
    ? (scores.reduce((sum, s) => sum + (parseFloat(String(s.score ?? "0")) || 0), 0) / scoredCount).toFixed(1)
    : "—";

  const SCORE_COLS = [
    { key: "attribute" as const, label: t("colAttribute") },
    { key: "weight" as const,    label: t("colWeight") },
    { key: "score" as const,     label: t("colScore") },
    { key: "remarks" as const,   label: t("colRemarks") },
  ];

  const HISTORY_COLS = [
    { key: "toStage" as const,  label: t("colStage"), cellType: "status" as const },
    { key: "remarks" as const,  label: t("colRemarks") },
    { key: "createdAt" as const, label: t("colAt") },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("titleWithPeriod", { period: appraisal.appraisalPeriod })}
        subtitle={t("subtitleEmployeeStage", { employeeId: appraisal.employeeId, stageLabel })}
        back="/hr/apar" backLabel="Back to APAR"
      />
      <DataSourceBadge source={result.source} />
      <StatGrid>
        <StatCard icon="\U0001f4cb" iconBg="#e6f0ff" label={t("statTotalCriteria")} value={scores.length} />
        <StatCard icon="✅"       iconBg="#e6f7f0" label={t("statScored")}         value={scoredCount} />
        <StatCard icon="\U0001f4ca" iconBg="#fff7e6" label={t("statAvgScore")}      value={avgScore} />
        <StatCard icon="\U0001f4dc" iconBg="#f5f5f5" label={t("statStageChanges")}  value={history.length} />
      </StatGrid>

      <Card title={t("appraisalDetailsTitle")}>
        <div style={{ padding: "16px 20px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 24px", fontSize: 14 }}>
          <div><span style={{ color: "var(--mut)", marginInlineEnd: 8 }}>{t("periodLabel")}</span><strong>{appraisal.appraisalPeriod}</strong></div>
          <div><span style={{ color: "var(--mut)", marginInlineEnd: 8 }}>{t("currentStageLabel")}</span><strong>{stageLabel}</strong></div>
          {appraisal.overallGrade && <div><span style={{ color: "var(--mut)", marginInlineEnd: 8 }}>{t("gradeLabel")}</span><strong>{appraisal.overallGrade}</strong></div>}
          {appraisal.overallBand && <div><span style={{ color: "var(--mut)", marginInlineEnd: 8 }}>{t("bandLabel")}</span><strong>{appraisal.overallBand}</strong></div>}
          {appraisal.reportingOfficerId && <div><span style={{ color: "var(--mut)", marginInlineEnd: 8 }}>{t("reportingOfficerLabel")}</span>{appraisal.reportingOfficerId}</div>}
          {appraisal.reviewingOfficerId && <div><span style={{ color: "var(--mut)", marginInlineEnd: 8 }}>{t("reviewingOfficerLabel")}</span>{appraisal.reviewingOfficerId}</div>}
          {appraisal.acceptingAuthorityId && <div><span style={{ color: "var(--mut)", marginInlineEnd: 8 }}>{t("acceptingAuthorityLabel")}</span>{appraisal.acceptingAuthorityId}</div>}
          {appraisal.disclosedAt && <div><span style={{ color: "var(--mut)", marginInlineEnd: 8 }}>{t("disclosedAtLabel")}</span>{new Date(appraisal.disclosedAt).toLocaleDateString("en-IN")}</div>}
          {appraisal.representationDue && <div><span style={{ color: "var(--mut)", marginInlineEnd: 8 }}>{t("representationDueLabel")}</span>{appraisal.representationDue}</div>}
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
          <DataTable<StageHistory>
            columns={HISTORY_COLS}
            rows={history}
            sortable
            filterable
            emptyIcon="🕓"
            emptyTitle={t("noHistoryTitle")}
            emptyMessage={t("noHistoryMessage")}
          />
        )}
      </Card>
      </div>

      <div style={{ marginTop: 16, padding: "12px 20px", background: "var(--bg2)", borderRadius: 8, fontSize: 13, color: "var(--mut)" }}>
        {t("workflowNoticeLine1")}
        {" "}
        {t("workflowNoticeLine2")}
      </div>
    </main>
  );
}
