"use client";

/**
 * GAP-RECOMMENDATIONS-NBA-02 / NBA-03: the predictive signals list used the
 * generic ID/Name/Detail/Status/Meta mapper, so an 8-char id prefix stood in
 * for a subject and the score could land in any column. This table names each
 * column explicitly (Subject, Model, Confidence, Score) and keeps the score as
 * a lossless decimal string.
 *
 * No Accept/Dismiss control is built here: the predictive endpoint is a
 * read-only ranked-score feed; accept/reject belongs to the NBA recommendation
 * state machine (POST /v1/recommendations/:id/accept|reject), which operates on
 * a different resource than the scores shown here. Building a mutation here
 * without that contract would be a fabricated feature (NBA-02 risk note), so it
 * stays read-only.
 */
import { DataTable } from "@/app/_components/ds/DataTable";
import type { NbaScoreRow } from "../_data";

export function NbaTable({ rows }: { rows: NbaScoreRow[] }) {
  return (
    <DataTable<NbaScoreRow & Record<string, unknown>>
      caption="Predictive model scores, highest score first"
      rows={rows as (NbaScoreRow & Record<string, unknown>)[]}
      columns={[
        { key: "subject", label: "Subject" },
        { key: "subjectType", label: "Type" },
        { key: "model", label: "Model" },
        { key: "confidence", label: "Confidence", align: "right", render: (r) => r.confidence ?? "—" },
        { key: "score", label: "Score", align: "right" },
      ]}
      sortable
      emptyIcon="🔮"
      emptyTitle="No predictive scores"
      emptyMessage="No model scores have been published for this tenant yet."
    />
  );
}
