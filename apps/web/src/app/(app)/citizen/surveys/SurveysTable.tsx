"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Card, DataTable, EmptyState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import type { CitizenSurvey } from "../../../_data/loaders";

type SurveyRow = {
  id: string;
  surveyName: string;
  responses: string;
  completion: string;
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

  const tableRows = useMemo<SurveyRow[]>(
    () =>
      rows.map((s) => ({
        id: s.id,
        surveyName: s.surveyName,
        responses: s.responses.toLocaleString("en-IN"),
        completion: s.completion,
        period: s.period,
        status: s.status,
      })),
    [rows],
  );

  return (
    <Card title={t("tableTitle")}>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      {tableRows.length === 0 ? (
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
            { key: "completion", label: t("colCompletion") },
            { key: "period", label: t("colPeriod") },
            { key: "status", label: t("colStatus"), cellType: "status" },
          ]}
        />
      )}
    </Card>
  );
}
