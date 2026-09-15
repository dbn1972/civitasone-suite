import Link from "next/link";
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

const SCORE_COLS = [
  { key: "attribute" as const, label: "Attribute" },
  { key: "weight" as const,    label: "Weight" },
  { key: "score" as const,     label: "Score" },
  { key: "remarks" as const,   label: "Remarks" },
];

const HISTORY_COLS = [
  { key: "toStage" as const,  label: "Stage", cellType: "status" as const },
  { key: "remarks" as const,  label: "Remarks" },
  { key: "createdAt" as const, label: "At" },
];

const STAGE_LABELS: Record<string, string> = {
  self_pending:        "1. Self Appraisal pending",
  reporting_officer:   "2. Reporting Officer review",
  reviewing_officer:   "3. Reviewing Officer concurrence",
  accepting_authority: "4. Accepting Authority finalisation",
  disclosed:           "5. Disclosed — representation window",
  representation:      "6. Representation filed",
  finalised:           "7. Finalised",
};

export default async function AparDetailPage({
  params,
}: {
  params: { id: string };
}) {
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
        <PageHeader title="APAR Detail" subtitle="Couldn't load" back="/hr/apar" />
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
        <PageHeader title="APAR Detail" subtitle="Not found" back="/hr/apar" />
        <DataSourceBadge source={result.source} />
        <Card title="">
          <EmptyState icon="📋" title="APAR not found" message="This appraisal record does not exist or you do not have access." />
        </Card>
      </main>
    );
  }

  const { appraisal, scores, history } = detail;
  const stageLabel  = STAGE_LABELS[appraisal.status] ?? appraisal.status;
  const scoredCount = scores.filter((s) => !!s.score).length;
  const avgScore    = scoredCount > 0
    ? (scores.reduce((sum, s) => sum + (parseFloat(String(s.score ?? "0")) || 0), 0) / scoredCount).toFixed(1)
    : "—";

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={`APAR — ${appraisal.appraisalPeriod}`}
        subtitle={`Employee ${appraisal.employeeId} · ${stageLabel}`}
        back="/hr/apar"
      />
      <DataSourceBadge source={result.source} />
      <StatGrid>
        <StatCard icon="\U0001f4cb" iconBg="#e6f0ff" label="Total Criteria" value={scores.length} />
        <StatCard icon="\u2705"       iconBg="#e6f7f0" label="Scored"         value={scoredCount} />
        <StatCard icon="\U0001f4ca" iconBg="#fff7e6" label="Avg Score"      value={avgScore} />
        <StatCard icon="\U0001f4dc" iconBg="#f5f5f5" label="Stage Changes"  value={history.length} />
      </StatGrid>

      <Card title="Appraisal Details">
        <div style={{ padding: "16px 20px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 24px", fontSize: 14 }}>
          <div><span style={{ color: "var(--mut)", marginRight: 8 }}>Period</span><strong>{appraisal.appraisalPeriod}</strong></div>
          <div><span style={{ color: "var(--mut)", marginRight: 8 }}>Current Stage</span><strong>{stageLabel}</strong></div>
          {appraisal.overallGrade && <div><span style={{ color: "var(--mut)", marginRight: 8 }}>Grade</span><strong>{appraisal.overallGrade}</strong></div>}
          {appraisal.overallBand && <div><span style={{ color: "var(--mut)", marginRight: 8 }}>Band</span><strong>{appraisal.overallBand}</strong></div>}
          {appraisal.reportingOfficerId && <div><span style={{ color: "var(--mut)", marginRight: 8 }}>Reporting Officer</span>{appraisal.reportingOfficerId}</div>}
          {appraisal.reviewingOfficerId && <div><span style={{ color: "var(--mut)", marginRight: 8 }}>Reviewing Officer</span>{appraisal.reviewingOfficerId}</div>}
          {appraisal.acceptingAuthorityId && <div><span style={{ color: "var(--mut)", marginRight: 8 }}>Accepting Authority</span>{appraisal.acceptingAuthorityId}</div>}
          {appraisal.disclosedAt && <div><span style={{ color: "var(--mut)", marginRight: 8 }}>Disclosed At</span>{new Date(appraisal.disclosedAt).toLocaleDateString("en-IN")}</div>}
          {appraisal.representationDue && <div><span style={{ color: "var(--mut)", marginRight: 8 }}>Representation Due</span>{appraisal.representationDue}</div>}
        </div>
        {appraisal.selfAppraisal && (
          <div style={{ padding: "0 20px 16px" }}>
            <p style={{ color: "var(--mut)", fontSize: 12, marginBottom: 4 }}>Self Appraisal</p>
            <p style={{ fontSize: 14 }}>{appraisal.selfAppraisal}</p>
          </div>
        )}
        {appraisal.reportingPenPicture && (
          <div style={{ padding: "0 20px 16px" }}>
            <p style={{ color: "var(--mut)", fontSize: 12, marginBottom: 4 }}>Reporting Officer — Pen Picture</p>
            <p style={{ fontSize: 14 }}>{appraisal.reportingPenPicture}</p>
          </div>
        )}
        {appraisal.representation && (
          <div style={{ padding: "0 20px 16px" }}>
            <p style={{ color: "var(--mut)", fontSize: 12, marginBottom: 4 }}>Officer Representation</p>
            <p style={{ fontSize: 14 }}>{appraisal.representation}</p>
          </div>
        )}
      </Card>

      <div style={{ marginTop: 16 }}>
      <Card title="Scores by Attribute">
        {scores.length === 0 ? (
          <EmptyState icon="📊" title="No scores yet" message="Scores are recorded by the Reporting Officer during their review stage." />
        ) : (
          <DataTable<Score>
            columns={SCORE_COLS}
            rows={scores}
            sortable
            filterable
            emptyIcon="📊"
            emptyTitle="No scores yet"
            emptyMessage="Scores are recorded by the Reporting Officer during their review stage."
          />
        )}
      </Card>
      </div>

      <div style={{ marginTop: 16 }}>
      <Card title="Stage History">
        {history.length === 0 ? (
          <EmptyState icon="🕓" title="No stage transitions yet" message="History is recorded as each authority completes their review." />
        ) : (
          <DataTable<StageHistory>
            columns={HISTORY_COLS}
            rows={history}
            sortable
            filterable
            emptyIcon="🕓"
            emptyTitle="No stage transitions yet"
            emptyMessage="History is recorded as each authority completes their review."
          />
        )}
      </Card>
      </div>

      <div style={{ marginTop: 16, padding: "12px 20px", background: "var(--bg2)", borderRadius: 8, fontSize: 13, color: "var(--mut)" }}>
        Stage actions (self-appraisal, reporting officer review, etc.) are performed via the APAR workflow API.
        Use the API or a dedicated workflow interface to advance this APAR to the next stage.
      </div>
    </main>
  );
}
