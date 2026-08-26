"use client";
import { DataTable, StatusPill } from "../../../_components/ds";
import { formatMoney } from "@/lib/formatters";
import type { RankedForecastStage } from "./forecast";

type StageRow = {
  stageId: string;
  stageName: string;
  probability: number;
  weightedTotalMinor: string;
  sharePct: number;
  band: string;
};

const BAND_LABEL: Record<string, string> = {
  high: "Likely",
  medium: "Possible",
  low: "Early",
};

export function StageBreakdownTable({ stages }: { stages: RankedForecastStage[] }) {
  const rows: StageRow[] = stages.map((stage) => ({
    stageId: stage.stageId,
    stageName: stage.stageName,
    probability: stage.probability,
    weightedTotalMinor: stage.weightedTotalMinor,
    sharePct: stage.sharePct,
    band: stage.band,
  }));

  return (
    <DataTable<StageRow>
      columns={[
        { key: "stageName", label: "Stage" },
        {
          key: "band",
          label: "Likelihood",
          render: (row) => <StatusPill status={BAND_LABEL[row.band] ?? row.band} />,
        },
        {
          key: "probability",
          label: "Probability",
          align: "right",
          render: (row) => `${row.probability}%`,
        },
        {
          key: "weightedTotalMinor",
          label: "Weighted Value",
          align: "right",
          render: (row) => formatMoney(row.weightedTotalMinor),
        },
        {
          key: "sharePct",
          label: "Share of Forecast",
          align: "right",
          render: (row) => `${row.sharePct.toFixed(2)}%`,
        },
      ]}
      rows={rows}
      sortable
      exportable
      exportFilename="crm-forecast-by-stage"
      emptyIcon="▽"
      emptyTitle="No forecast yet"
      emptyMessage="A forecast appears once you have active engagements sitting in a pipeline stage with a win probability above zero."
      emptyAction={<a className="btn primary" href="/crm/deals/new">+ New Engagement</a>}
    />
  );
}
