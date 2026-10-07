/**
 * Per-domain metric semantics for the ML Insights pages.
 *
 * Each ML domain reports its headline quality under a DIFFERENT metric
 * (AUC-ROC for leads/subscriptions, precision for tickets/transactions,
 * MAPE — lower is better — for inventory demand forecasting). Treating them
 * all as a single higher-is-better "accuracy" number (the old behaviour)
 * both mislabels the stat for screen-reader users and inverts the trend
 * colour for MAPE. This module is the single source of truth for a domain's
 * metric label, its direction, the good/warn colour thresholds, and how its
 * per-row prediction value should be formatted.
 *
 * GAP-ANALYTICS-ML-INSIGHTS-02/03/04, -ANOMALIES-03, -INVENTORY-03/04,
 * -LEADS-02, -PROJECTS-03, -SUBSCRIPTIONS-03, -TICKETS-02.
 */

export type MetricThresholds = { good: number; warn: number };

export type MetricConfig = {
  /** The metric's own name, e.g. "AUC-ROC", "Precision", "MAPE". */
  label: string;
  /** false for error metrics (MAPE) where a smaller value is better. */
  higherIsBetter: boolean;
  /** Colour cut-offs on the 0..1 axis, interpreted per `higherIsBetter`. */
  thresholds: MetricThresholds;
};

/** How a per-row prediction value should be rendered. */
export type PredictionKind = "probability" | "value" | "date";

const HIGHER_DEFAULT: MetricThresholds = { good: 0.7, warn: 0.4 };
/** For MAPE: <=15% is good, <=30% is fair, worse is poor. */
const MAPE_THRESHOLDS: MetricThresholds = { good: 0.15, warn: 0.3 };

export const DOMAIN_METRICS: Record<
  string,
  { metric: MetricConfig; predictionKind: PredictionKind }
> = {
  leads: {
    metric: { label: "AUC-ROC", higherIsBetter: true, thresholds: HIGHER_DEFAULT },
    predictionKind: "probability",
  },
  tickets: {
    metric: { label: "Precision", higherIsBetter: true, thresholds: HIGHER_DEFAULT },
    predictionKind: "probability",
  },
  subscriptions: {
    metric: { label: "AUC-ROC", higherIsBetter: true, thresholds: HIGHER_DEFAULT },
    predictionKind: "probability",
  },
  transactions: {
    metric: { label: "Precision", higherIsBetter: true, thresholds: HIGHER_DEFAULT },
    predictionKind: "probability",
  },
  inventory: {
    metric: { label: "MAPE", higherIsBetter: false, thresholds: MAPE_THRESHOLDS },
    predictionKind: "value",
  },
  tasks: {
    metric: { label: "Prediction accuracy", higherIsBetter: true, thresholds: HIGHER_DEFAULT },
    predictionKind: "date",
  },
};

const FALLBACK_METRIC: { metric: MetricConfig; predictionKind: PredictionKind } = {
  metric: { label: "Accuracy", higherIsBetter: true, thresholds: HIGHER_DEFAULT },
  predictionKind: "probability",
};

export function metricForDomain(domain: string): MetricConfig {
  return (DOMAIN_METRICS[domain] ?? FALLBACK_METRIC).metric;
}

export function predictionKindForDomain(domain: string): PredictionKind {
  return (DOMAIN_METRICS[domain] ?? FALLBACK_METRIC).predictionKind;
}

/**
 * Status band ("good" | "warn" | "poor") for a 0..1 metric value under a
 * given direction/thresholds. Used for both the bar colour AND a non-colour
 * text cue so colour is never the only signal (WCAG 1.4.1).
 */
export function metricBand(
  value: number,
  metric: Pick<MetricConfig, "higherIsBetter" | "thresholds">,
): "good" | "warn" | "poor" {
  const { good, warn } = metric.thresholds;
  if (metric.higherIsBetter) {
    if (value >= good) return "good";
    if (value >= warn) return "warn";
    return "poor";
  }
  // lower is better (e.g. MAPE)
  if (value <= good) return "good";
  if (value <= warn) return "warn";
  return "poor";
}
