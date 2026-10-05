"use client";
import Link from "next/link";
import { DataTable, StatusPill } from "../../../_components/ds";
import { formatMoney } from "@/lib/formatters";
import { PROBABILITY_BAND_THRESHOLDS, type RankedForecastStage } from "./forecast";

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
  // GAP-CRM-FORECAST-04: in the "All pipelines" view the breakdown is keyed by
  // stageId, so two pipelines that each have a stage named (e.g.) "Proposal"
  // produce two rows with an identical label — indistinguishable to the user.
  // Detect any stageName shared by more than one stageId and disambiguate those
  // rows with a short, stable suffix from the stageId, so a reviewer can tell
  // the two apart. Names that are already unique are left untouched.
  const nameCounts = new Map<string, number>();
  for (const stage of stages) {
    nameCounts.set(stage.stageName, (nameCounts.get(stage.stageName) ?? 0) + 1);
  }
  const rows: StageRow[] = stages.map((stage) => {
    const collides = (nameCounts.get(stage.stageName) ?? 0) > 1;
    return {
      stageId: stage.stageId,
      stageName: collides ? `${stage.stageName} · ${stage.stageId.slice(0, 8)}` : stage.stageName,
      probability: stage.probability,
      weightedTotalMinor: stage.weightedTotalMinor,
      sharePct: stage.sharePct,
      band: stage.band,
    };
  });

  return (
    <>
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
        emptyAction={<Link className="btn primary" href="/crm/deals/new">+ New Engagement</Link>}
      />
      {/* GAP-CRM-FORECAST-05: make the (previously hidden) likelihood thresholds
          visible, generated from the exported constants, and be honest that the
          share column is truncated and may total slightly under 100%. */}
      {rows.length > 0 ? (
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "8px 2px 0" }}>
          Likelihood: <strong>{BAND_LABEL.high}</strong> ≥ {PROBABILITY_BAND_THRESHOLDS.high}%,{" "}
          <strong>{BAND_LABEL.medium}</strong> {PROBABILITY_BAND_THRESHOLDS.medium}–{PROBABILITY_BAND_THRESHOLDS.high - 1}%,{" "}
          <strong>{BAND_LABEL.low}</strong> &lt; {PROBABILITY_BAND_THRESHOLDS.medium}%. Shares are truncated to two
          decimals and may total slightly under 100%.
        </p>
      ) : null}
    </>
  );
}
