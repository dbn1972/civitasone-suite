"use client";

import { DataTable } from "@/app/_components/ds";
import type { RecentPredictionRow } from "../_data";

interface RecentPredictionsTableProps {
  predictions: RecentPredictionRow[];
  source: "api" | "error";
  /** URL prefix for drill-through links to entity detail pages */
  rowLinkPrefix?: string;
}

function formatConfidence(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

type TableRow = {
  id: string;
  entityId: string;
  prediction: string;
  confidence: string;
  outcome: string;
  createdAt: string;
};

export function RecentPredictionsTable({ predictions, source, rowLinkPrefix }: RecentPredictionsTableProps) {
  const rows: TableRow[] = predictions.map((p) => ({
    id: p.id,
    entityId: p.entityId,
    prediction: formatConfidence(p.prediction),
    confidence: formatConfidence(p.confidence),
    outcome: p.outcome ?? "Pending",
    createdAt: formatDate(p.createdAt),
  }));

  return (
    <DataTable<TableRow>
      columns={[
        { key: "entityId", label: "Entity" },
        { key: "prediction", label: "Prediction", align: "right" },
        { key: "confidence", label: "Confidence", align: "right" },
        { key: "outcome", label: "Outcome", cellType: "status" },
        { key: "createdAt", label: "Date" },
      ]}
      rows={rows}
      rowLinkKey="entityId"
      rowLinkPrefix={rowLinkPrefix}
      sortable
      filterable
      filterPlaceholder="Filter predictions…"
      pageSize={15}
      exportable
      exportFilename="ms-predictions"
      emptyIcon="🤖"
      emptyTitle="No predictions yet"
      emptyMessage="Predictions will appear here once the ML model is active and producing results."
    />
  );
}
