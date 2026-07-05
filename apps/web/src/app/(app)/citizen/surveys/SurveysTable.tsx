"use client";

import { useMemo } from "react";
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
    <Card title="Survey Register">
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0", padding: "8px 16px 0" }}>
          {cacheNote}
        </p>
      ) : null}
      {tableRows.length === 0 ? (
        <EmptyState icon="📊" title="No surveys found" message="Public opinion surveys will appear here once created." />
      ) : (
        <DataTable<SurveyRow>
          rows={tableRows}
          sortable
          filterable
          filterPlaceholder="Search survey name, period…"
          pageSize={15}
          exportable
          exportFilename="citizen-surveys"
          columns={[
            { key: "surveyName", label: "Survey Name" },
            { key: "responses", label: "Responses", align: "right" },
            { key: "completion", label: "Completion %" },
            { key: "period", label: "Period" },
            { key: "status", label: "Status", cellType: "status" },
          ]}
        />
      )}
    </Card>
  );
}
