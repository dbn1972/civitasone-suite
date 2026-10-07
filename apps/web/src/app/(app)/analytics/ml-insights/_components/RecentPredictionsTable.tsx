"use client";

import { DataTable } from "@/app/_components/ds";
import type { RecentPredictionRow } from "../_data";
import type { PredictionKind } from "../_metrics";

interface RecentPredictionsTableProps {
  predictions: RecentPredictionRow[];
  /**
   * Retained for call-site compatibility; the error branch is handled by the
   * parent DomainInsightPage before this component ever renders, so it is not
   * read here.
   */
  source?: "api" | "error";
  /** URL prefix for drill-through links to entity detail pages */
  rowLinkPrefix?: string;
  /** Domain key, used for the export filename and audit action. */
  domain: string;
  /** How to format the per-row prediction value. */
  predictionKind?: PredictionKind;
  /** Fail-closed: only render the CSV export when the caller permits it. */
  canExport?: boolean;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * Format a prediction value per the domain's output type: a probability is a
 * percentage, a plain value (e.g. forecast quantity) is a locale number, and
 * a date model's output (days/ISO) renders as a date. GAP-*-UUID.
 */
function formatPrediction(value: number, kind: PredictionKind): string {
  switch (kind) {
    case "value":
      return value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
    case "date":
      // A delay model emits a number of days; show it as a signed day count.
      return `${value > 0 ? "+" : ""}${Math.round(value)}d`;
    case "probability":
    default:
      return formatPercent(value);
  }
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

/**
 * Entity display text: a human label when the API provides one, otherwise a
 * shortened id (last 8 chars) so an opaque UUID isn't shown in full. The full
 * id stays available via the row title and the drill-through href (which still
 * uses entityId). GAP-*-UUID.
 */
export function entityDisplay(row: RecentPredictionRow): string {
  if (row.entityLabel && row.entityLabel.trim() !== "") return row.entityLabel;
  const id = row.entityId;
  if (!id) return "—";
  return id.length > 8 ? `…${id.slice(-8)}` : id;
}

type TableRow = {
  id: string;
  entityId: string;
  entity: string;
  entityTitle: string;
  prediction: string;
  confidence: string;
  outcome: string;
  createdAt: string;
};

/**
 * GAP-*-ML-INSIGHTS-*-07/08 (EXPORT/PII): the CSV carries scored entity ids
 * and model scores. Record each export (fire-and-forget — never blocks the
 * user's own download). The raw text filter is never sent, only whether one
 * was active.
 */
export async function recordMlPredictionsExport(
  domain: string,
  info: { rowCount: number; filter: string },
): Promise<void> {
  await fetch("/api/proxy/v1/ml/predictions/export-audit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ domain, rowCount: info.rowCount, filtered: info.filter.trim() !== "" }),
  });
}

export function RecentPredictionsTable({
  predictions,
  rowLinkPrefix,
  domain,
  predictionKind = "probability",
  canExport = false,
}: RecentPredictionsTableProps) {
  const rows: TableRow[] = predictions.map((p) => ({
    id: p.id,
    entityId: p.entityId,
    entity: entityDisplay(p),
    entityTitle: p.entityId,
    prediction: formatPrediction(p.prediction, predictionKind),
    confidence: formatPercent(p.confidence),
    outcome: p.outcome ?? "Pending",
    createdAt: formatDate(p.createdAt),
  }));

  return (
    <DataTable<TableRow>
      columns={[
        { key: "entity", label: "Entity" },
        { key: "prediction", label: "Prediction", align: "right" },
        { key: "confidence", label: "Confidence", align: "right" },
        { key: "outcome", label: "Outcome", cellType: "status" },
        { key: "createdAt", label: "Date" },
      ]}
      rows={rows}
      // Display the label but build the drill-through href from the real id.
      rowLinkKey="entityId"
      rowLinkPrefix={rowLinkPrefix}
      identifyingColumnKey="entity"
      sortable
      filterable
      filterPlaceholder="Filter predictions…"
      pageSize={15}
      exportable={canExport}
      exportFilename={`ml-${domain}-predictions`}
      exportNotice={canExport ? "Export leaves the system and is recorded." : undefined}
      onExport={canExport ? (info) => { void recordMlPredictionsExport(domain, info).catch(() => undefined); } : undefined}
      emptyIcon="🤖"
      emptyTitle="No predictions yet"
      emptyMessage="Predictions will appear here once the ML model is active and producing results."
    />
  );
}
