/**
 * ML Service Observability — OpenTelemetry-style metrics for prediction monitoring.
 *
 * Emits:
 * - Prediction count per domain (counter)
 * - Prediction latency histogram (histogram)
 * - Fallback rate per domain (counter-derived gauge)
 * - Confidence distribution per domain (histogram)
 * - WARN alert metric when fallback rate > 20% over 5-min window
 * - Drift alert metric when avg confidence < 0.40 over 1-hour window
 *
 * Validates: Requirements 18.1, 18.2, 18.3, 18.4, 18.5
 */

import { pino } from "pino";

const log = pino({ name: "ml-observability" });

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PredictionMetricEvent {
  correlationId: string;
  tenantId: string;
  domain: string;
  latencyMs: number;
  confidence: number;
  isFallback: boolean;
}

export interface ConsumerMetricEvent {
  messageId: string;
  topic: string;
  tenantId: string;
  processingTimeMs: number;
  outcome: "processed" | "skipped" | "failed" | "dead-lettered";
}

// ─── Counters ────────────────────────────────────────────────────────────────

/** Prediction count per domain (total) */
const predictionCountByDomain = new Map<string, number>();

/** Fallback count per domain */
const fallbackCountByDomain = new Map<string, number>();

/** Consumer message count per topic */
const consumerMessageCount = new Map<string, number>();

/** Consumer message by outcome */
const consumerOutcomeCount = new Map<string, number>();

// ─── Latency Histogram ───────────────────────────────────────────────────────

const LATENCY_BUCKETS_MS = [5, 10, 25, 50, 100, 200, 500, 1000, 2000, 5000];

interface HistogramData {
  buckets: number[];
  sum: number;
  count: number;
}

/** Prediction latency histogram per domain */
const predictionLatency = new Map<string, HistogramData>();

// ─── Confidence Distribution ─────────────────────────────────────────────────

const CONFIDENCE_BUCKETS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

/** Confidence distribution histogram per domain */
const confidenceDistribution = new Map<string, HistogramData>();

// ─── Sliding Window for Alert Detection ──────────────────────────────────────

interface WindowEntry {
  timestamp: number;
  isFallback: boolean;
  confidence: number;
  domain: string;
}

/**
 * Sliding window of prediction events for alert evaluation.
 * Entries older than 1 hour are pruned periodically.
 */
const predictionWindow: WindowEntry[] = [];

/** Maximum window size (1 hour = longest alert window) */
const MAX_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/** Fallback rate alert window (5 minutes) */
const FALLBACK_ALERT_WINDOW_MS = 5 * 60 * 1000;

/** Fallback rate threshold (20%) */
const FALLBACK_RATE_THRESHOLD = 0.20;

/** Drift alert window (1 hour) */
const DRIFT_ALERT_WINDOW_MS = 60 * 60 * 1000;

/** Drift confidence threshold (avg confidence < 0.40) */
const DRIFT_CONFIDENCE_THRESHOLD = 0.40;

/** Alert counters for /metrics exposure */
const alertCounters = {
  fallbackRateWarn: new Map<string, number>(), // domain -> count
  driftAlert: new Map<string, number>(), // domain -> count
};

// ─── Core Functions ──────────────────────────────────────────────────────────

/**
 * Record a prediction event for metrics and alerting.
 * Called after every prediction response (success or fallback).
 */
export function recordPrediction(event: PredictionMetricEvent): void {
  const { domain, latencyMs, confidence, isFallback } = event;

  // Increment prediction counter
  predictionCountByDomain.set(domain, (predictionCountByDomain.get(domain) ?? 0) + 1);

  // Increment fallback counter if applicable
  if (isFallback) {
    fallbackCountByDomain.set(domain, (fallbackCountByDomain.get(domain) ?? 0) + 1);
  }

  // Record latency histogram
  recordHistogram(predictionLatency, domain, latencyMs, LATENCY_BUCKETS_MS);

  // Record confidence distribution
  recordHistogram(confidenceDistribution, domain, confidence, CONFIDENCE_BUCKETS);

  // Add to sliding window for alert evaluation
  predictionWindow.push({
    timestamp: Date.now(),
    isFallback,
    confidence,
    domain,
  });

  // Evaluate alerts
  evaluateAlerts(domain);

  // Structured prediction log (no PII)
  log.info({
    correlationId: event.correlationId,
    tenantId: event.tenantId,
    domain,
    latencyMs,
    confidence,
    isFallback,
  }, "ml_prediction_recorded");
}

/**
 * Record a consumer message event for metrics.
 * Called after every consumer message handling.
 */
export function recordConsumerMessage(event: ConsumerMetricEvent): void {
  const { messageId, topic, tenantId, processingTimeMs, outcome } = event;

  // Increment consumer counter by topic
  consumerMessageCount.set(topic, (consumerMessageCount.get(topic) ?? 0) + 1);

  // Increment outcome counter
  const outcomeKey = `${topic}:${outcome}`;
  consumerOutcomeCount.set(outcomeKey, (consumerOutcomeCount.get(outcomeKey) ?? 0) + 1);

  // Structured consumer log (no PII)
  log.info({
    messageId,
    topic,
    tenantId,
    processingTimeMs,
    outcome,
  }, "ml_consumer_message_processed");
}

// ─── Alert Evaluation ────────────────────────────────────────────────────────

function evaluateAlerts(domain: string): void {
  const now = Date.now();

  // Prune entries older than max window
  pruneWindow(now);

  // Evaluate fallback rate alert (5-min window)
  evaluateFallbackRateAlert(domain, now);

  // Evaluate drift alert (1-hour window)
  evaluateDriftAlert(domain, now);
}

function evaluateFallbackRateAlert(domain: string, now: number): void {
  const windowStart = now - FALLBACK_ALERT_WINDOW_MS;
  const domainEntries = predictionWindow.filter(
    (e) => e.domain === domain && e.timestamp >= windowStart,
  );

  if (domainEntries.length === 0) return;

  const fallbackCount = domainEntries.filter((e) => e.isFallback).length;
  const fallbackRate = fallbackCount / domainEntries.length;

  if (fallbackRate > FALLBACK_RATE_THRESHOLD) {
    alertCounters.fallbackRateWarn.set(
      domain,
      (alertCounters.fallbackRateWarn.get(domain) ?? 0) + 1,
    );
    log.warn({
      domain,
      fallbackRate: Math.round(fallbackRate * 100) / 100,
      fallbackCount,
      totalPredictions: domainEntries.length,
      windowMinutes: 5,
    }, "ml_fallback_rate_exceeded: fallback rate > 20% over 5-min window");
  }
}

function evaluateDriftAlert(domain: string, now: number): void {
  const windowStart = now - DRIFT_ALERT_WINDOW_MS;
  const domainEntries = predictionWindow.filter(
    (e) => e.domain === domain && e.timestamp >= windowStart && !e.isFallback,
  );

  if (domainEntries.length === 0) return;

  const avgConfidence =
    domainEntries.reduce((sum, e) => sum + e.confidence, 0) / domainEntries.length;

  if (avgConfidence < DRIFT_CONFIDENCE_THRESHOLD) {
    alertCounters.driftAlert.set(
      domain,
      (alertCounters.driftAlert.get(domain) ?? 0) + 1,
    );
    log.warn({
      domain,
      avgConfidence: Math.round(avgConfidence * 1000) / 1000,
      sampleCount: domainEntries.length,
      windowMinutes: 60,
    }, "ml_drift_alert: average confidence < 0.40 over 1-hour window");
  }
}

function pruneWindow(now: number): void {
  const cutoff = now - MAX_WINDOW_MS;
  // Remove entries older than 1 hour from the front (oldest first)
  while (predictionWindow.length > 0 && predictionWindow[0]!.timestamp < cutoff) {
    predictionWindow.shift();
  }
}

// ─── Histogram Helper ────────────────────────────────────────────────────────

function recordHistogram(
  store: Map<string, HistogramData>,
  key: string,
  value: number,
  bucketBounds: number[],
): void {
  let h = store.get(key);
  if (!h) {
    h = { buckets: new Array(bucketBounds.length + 1).fill(0) as number[], sum: 0, count: 0 };
    store.set(key, h);
  }
  h.sum += value;
  h.count += 1;
  let placed = false;
  for (let i = 0; i < bucketBounds.length; i++) {
    if (value <= bucketBounds[i]!) {
      h.buckets[i]! += 1;
      placed = true;
      break;
    }
  }
  if (!placed) {
    h.buckets[bucketBounds.length]! += 1;
  }
}

// ─── Prometheus /metrics Formatting ──────────────────────────────────────────

/**
 * Format all ML-specific metrics as Prometheus text exposition.
 * Called by the /metrics endpoint handler.
 */
export function formatMlMetrics(): string[] {
  const lines: string[] = [];

  // Prediction count per domain
  lines.push(
    "# HELP ml_predictions_total Total predictions by domain",
    "# TYPE ml_predictions_total counter",
  );
  for (const [domain, count] of predictionCountByDomain) {
    lines.push(`ml_predictions_total{domain="${domain}"} ${count}`);
  }

  // Fallback count per domain
  lines.push(
    "# HELP ml_predictions_fallback_total Fallback predictions by domain",
    "# TYPE ml_predictions_fallback_total counter",
  );
  for (const [domain, count] of fallbackCountByDomain) {
    lines.push(`ml_predictions_fallback_total{domain="${domain}"} ${count}`);
  }

  // Prediction latency histogram per domain
  lines.push(
    "# HELP ml_prediction_latency_ms Prediction latency in milliseconds by domain",
    "# TYPE ml_prediction_latency_ms histogram",
  );
  for (const [domain, h] of predictionLatency) {
    const labels = `domain="${domain}"`;
    let cumulative = 0;
    for (let i = 0; i < LATENCY_BUCKETS_MS.length; i++) {
      cumulative += h.buckets[i]!;
      lines.push(`ml_prediction_latency_ms_bucket{${labels},le="${LATENCY_BUCKETS_MS[i]}"} ${cumulative}`);
    }
    cumulative += h.buckets[LATENCY_BUCKETS_MS.length]!;
    lines.push(`ml_prediction_latency_ms_bucket{${labels},le="+Inf"} ${cumulative}`);
    lines.push(`ml_prediction_latency_ms_sum{${labels}} ${h.sum}`);
    lines.push(`ml_prediction_latency_ms_count{${labels}} ${h.count}`);
  }

  // Confidence distribution histogram per domain
  lines.push(
    "# HELP ml_prediction_confidence Prediction confidence distribution by domain",
    "# TYPE ml_prediction_confidence histogram",
  );
  for (const [domain, h] of confidenceDistribution) {
    const labels = `domain="${domain}"`;
    let cumulative = 0;
    for (let i = 0; i < CONFIDENCE_BUCKETS.length; i++) {
      cumulative += h.buckets[i]!;
      lines.push(`ml_prediction_confidence_bucket{${labels},le="${CONFIDENCE_BUCKETS[i]}"} ${cumulative}`);
    }
    cumulative += h.buckets[CONFIDENCE_BUCKETS.length]!;
    lines.push(`ml_prediction_confidence_bucket{${labels},le="+Inf"} ${cumulative}`);
    lines.push(`ml_prediction_confidence_sum{${labels}} ${h.sum}`);
    lines.push(`ml_prediction_confidence_count{${labels}} ${h.count}`);
  }

  // Consumer message counters
  lines.push(
    "# HELP ml_consumer_messages_total Consumer messages processed by topic",
    "# TYPE ml_consumer_messages_total counter",
  );
  for (const [topic, count] of consumerMessageCount) {
    lines.push(`ml_consumer_messages_total{topic="${topic}"} ${count}`);
  }

  // Consumer outcome counters
  lines.push(
    "# HELP ml_consumer_outcome_total Consumer message outcomes by topic and outcome",
    "# TYPE ml_consumer_outcome_total counter",
  );
  for (const [key, count] of consumerOutcomeCount) {
    const sep = key.lastIndexOf(":");
    const topic = key.slice(0, sep);
    const outcome = key.slice(sep + 1);
    lines.push(`ml_consumer_outcome_total{topic="${topic}",outcome="${outcome}"} ${count}`);
  }

  // Alert counters
  lines.push(
    "# HELP ml_fallback_rate_alerts_total WARN alerts emitted when fallback rate exceeds 20% over 5-min window",
    "# TYPE ml_fallback_rate_alerts_total counter",
  );
  for (const [domain, count] of alertCounters.fallbackRateWarn) {
    lines.push(`ml_fallback_rate_alerts_total{domain="${domain}"} ${count}`);
  }

  lines.push(
    "# HELP ml_drift_alerts_total Alerts emitted when avg confidence drops below 0.40 over 1-hour window",
    "# TYPE ml_drift_alerts_total counter",
  );
  for (const [domain, count] of alertCounters.driftAlert) {
    lines.push(`ml_drift_alerts_total{domain="${domain}"} ${count}`);
  }

  return lines;
}

// ─── Test Helpers ────────────────────────────────────────────────────────────

/** Reset all metrics — test helper */
export function resetMlMetrics(): void {
  predictionCountByDomain.clear();
  fallbackCountByDomain.clear();
  consumerMessageCount.clear();
  consumerOutcomeCount.clear();
  predictionLatency.clear();
  confidenceDistribution.clear();
  predictionWindow.length = 0;
  alertCounters.fallbackRateWarn.clear();
  alertCounters.driftAlert.clear();
}

/** Get prediction count for a domain — test helper */
export function getPredictionCount(domain: string): number {
  return predictionCountByDomain.get(domain) ?? 0;
}

/** Get fallback count for a domain — test helper */
export function getFallbackCount(domain: string): number {
  return fallbackCountByDomain.get(domain) ?? 0;
}

/** Get fallback rate alert count for a domain — test helper */
export function getFallbackRateAlertCount(domain: string): number {
  return alertCounters.fallbackRateWarn.get(domain) ?? 0;
}

/** Get drift alert count for a domain — test helper */
export function getDriftAlertCount(domain: string): number {
  return alertCounters.driftAlert.get(domain) ?? 0;
}

/** Get consumer message count for a topic — test helper */
export function getConsumerMessageCount(topic: string): number {
  return consumerMessageCount.get(topic) ?? 0;
}

/** Get the current prediction window size — test helper */
export function getPredictionWindowSize(): number {
  return predictionWindow.length;
}
