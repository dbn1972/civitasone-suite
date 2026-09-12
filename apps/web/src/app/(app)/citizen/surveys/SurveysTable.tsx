"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Card, DataTable, EmptyState } from "../../../_components/ds";
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
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<CitizenSurvey[]>(
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

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <Card title={t("tableTitle")}>
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0", padding: "8px 16px 0" }}>
          {cacheNote}
        </p>
      ) : null}
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
