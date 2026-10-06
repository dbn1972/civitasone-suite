"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Card, DataTable, EmptyState, StatCard, StatGrid } from "../../../_components/ds";
import { RefreshErrorState } from "../../../_components/ds/RefreshErrorState";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { toHumanError } from "@/lib/messages";
import {
  parseCompletionPct,
  summarizeSurveys,
  type CitizenSurvey,
} from "@/lib/citizenSurveys";

type SurveyRow = {
  id: string;
  surveyName: string;
  responses: string;
  completion: string;
  completionPct: number | null;
  period: string;
  status: string;
} & Record<string, unknown>;

export function SurveysTable({ surveys, source = "api" }: { surveys: CitizenSurvey[]; source?: "api" | "error" }) {
  const t = useTranslations("citizenSurveys");
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<CitizenSurvey[]>(
    "citizen.surveys",
    surveys,
    source,
    (d) => d.length === 0,
  );

  // GAP-CITIZEN-SURVEYS-02: stats are computed from the SAME rows the table
  // shows (one useSeededResource), so cards and table can never disagree
  // (previously stats came from the raw server prop while rows could be the
  // cached copy). GAP-CITIZEN-SURVEYS-03: counts normalise the free-string
  // status so "active"/" Active " are counted, not just exact "Active".
  const summary = useMemo(() => summarizeSurveys(rows), [rows]);

  // GAP-CITIZEN-SURVEYS-01: a failed fetch with no cached rows must not read as
  // "0 surveys / none found" — show "—" stats and a retry, not good news.
  const errored = provenance === "error-no-data" || (source === "error" && rows.length === 0);
  const statOrDash = (n: number): number | string => (errored && rows.length === 0 ? "—" : n);

  const tableRows = useMemo<SurveyRow[]>(
    () =>
      rows.map((s) => ({
        id: s.id,
        surveyName: s.surveyName,
        responses: s.responses.toLocaleString("en-IN"),
        completion: s.completion,
        completionPct: parseCompletionPct(s.completion),
        period: s.period,
        status: s.status,
      })),
    [rows],
  );

  return (
    <>
      <StatGrid>
        <StatCard icon="📊" iconBg="var(--infobg)" label={t("statActive")} value={statOrDash(summary.active)} />
        <StatCard
          icon="📝"
          iconBg="var(--goodbg)"
          label={t("statTotalResponses")}
          value={errored && rows.length === 0 ? "—" : summary.totalResponses.toLocaleString("en-IN")}
        />
        <StatCard icon="✅" iconBg="var(--warnbg)" label={t("statCompleted")} value={statOrDash(summary.completed)} />
        <StatCard icon="📅" iconBg="var(--badbg)" label={t("statTotalSurveys")} value={statOrDash(summary.total)} />
      </StatGrid>

      <Card title={t("tableTitle")}>
        {/* UX-012: single provenance badge, driven by the same useSeededResource call. */}
        <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
        {errored && rows.length === 0 ? (
          <RefreshErrorState error={toHumanError("load", { area: "surveys" })} source={{ area: "surveys" }} />
        ) : tableRows.length === 0 ? (
          <EmptyState icon="📊" title={t("emptyTitle")} message={t("emptyMessage")} />
        ) : (
          <DataTable<SurveyRow>
            rows={tableRows}
            sortable
            filterable
            filterPlaceholder={t("filterPlaceholder")}
            pageSize={15}
            exportable
            exportFilename="citizen-surveys"
            columns={[
              { key: "surveyName", label: t("colSurveyName") },
              { key: "responses", label: t("colResponses"), align: "right" },
              {
                key: "completionPct",
                label: t("colCompletion"),
                render: (r) =>
                  r.completionPct == null ? (
                    <span style={{ color: "var(--mut)" }}>{r.completion || "—"}</span>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 120 }}>
                      <div
                        className="bar"
                        role="progressbar"
                        aria-valuenow={Math.round(r.completionPct)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`${r.surveyName}: ${Math.round(r.completionPct)}%`}
                        style={{ flex: 1 }}
                      >
                        <i style={{ width: `${r.completionPct}%` }} />
                      </div>
                      <span style={{ fontSize: 12, color: "var(--ink2)", minWidth: 36, textAlign: "right" }}>
                        {Math.round(r.completionPct)}%
                      </span>
                    </div>
                  ),
              },
              { key: "period", label: t("colPeriod") },
              { key: "status", label: t("colStatus"), cellType: "status" },
            ]}
          />
        )}
      </Card>
    </>
  );
}
