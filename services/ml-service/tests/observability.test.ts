/**
 * Tests for ML Service Observability Module
 *
 * Validates: Requirements 18.1, 18.2, 18.3, 18.4, 18.5
 *
 * Covers:
 * - Prediction count per domain
 * - Latency histogram recording
 * - Fallback rate tracking
 * - Confidence distribution
 * - WARN alert when fallback rate > 20% over 5-min window
 * - Drift alert when avg confidence < 0.40 over 1-hour window
 * - Consumer message logging
 * - /metrics endpoint exposure
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  recordPrediction,
  recordConsumerMessage,
  formatMlMetrics,
  resetMlMetrics,
  getPredictionCount,
  getFallbackCount,
  getFallbackRateAlertCount,
  getDriftAlertCount,
  getConsumerMessageCount,
  getPredictionWindowSize,
} from "../src/modules/observability/metrics.js";

describe("ML Observability Metrics", () => {
  beforeEach(() => {
    resetMlMetrics();
  });

  describe("recordPrediction", () => {
    it("increments prediction count per domain", () => {
      recordPrediction({
        correlationId: "corr-1",
        tenantId: "tenant-1",
        domain: "leads",
        latencyMs: 50,
        confidence: 0.85,
        isFallback: false,
      });
      recordPrediction({
        correlationId: "corr-2",
        tenantId: "tenant-1",
        domain: "leads",
        latencyMs: 30,
        confidence: 0.72,
        isFallback: false,
      });
      recordPrediction({
        correlationId: "corr-3",
        tenantId: "tenant-1",
        domain: "tickets",
        latencyMs: 80,
        confidence: 0.60,
        isFallback: false,
      });

      expect(getPredictionCount("leads")).toBe(2);
      expect(getPredictionCount("tickets")).toBe(1);
      expect(getPredictionCount("inventory")).toBe(0);
    });

    it("increments fallback count when isFallback is true", () => {
      recordPrediction({
        correlationId: "corr-1",
        tenantId: "tenant-1",
        domain: "leads",
        latencyMs: 10,
        confidence: 0,
        isFallback: true,
      });
      recordPrediction({
        correlationId: "corr-2",
        tenantId: "tenant-1",
        domain: "leads",
        latencyMs: 50,
        confidence: 0.80,
        isFallback: false,
      });

      expect(getFallbackCount("leads")).toBe(1);
      expect(getPredictionCount("leads")).toBe(2);
    });

    it("adds entries to the sliding window", () => {
      recordPrediction({
        correlationId: "corr-1",
        tenantId: "tenant-1",
        domain: "leads",
        latencyMs: 50,
        confidence: 0.85,
        isFallback: false,
      });

      expect(getPredictionWindowSize()).toBe(1);
    });
  });

  describe("fallback rate alert (requirement 18.3)", () => {
    it("emits WARN alert metric when fallback rate exceeds 20% over 5-min window", () => {
      // Generate 10 predictions: 3 fallbacks (30% > 20% threshold)
      for (let i = 0; i < 7; i++) {
        recordPrediction({
          correlationId: `corr-ok-${i}`,
          tenantId: "tenant-1",
          domain: "leads",
          latencyMs: 50,
          confidence: 0.80,
          isFallback: false,
        });
      }
      for (let i = 0; i < 3; i++) {
        recordPrediction({
          correlationId: `corr-fb-${i}`,
          tenantId: "tenant-1",
          domain: "leads",
          latencyMs: 10,
          confidence: 0,
          isFallback: true,
        });
      }

      // 30% fallback rate > 20% threshold should trigger alert
      expect(getFallbackRateAlertCount("leads")).toBeGreaterThan(0);
    });

    it("does NOT emit alert when fallback rate is below 20%", () => {
      // 10 predictions: 1 fallback (10% < 20% threshold)
      for (let i = 0; i < 9; i++) {
        recordPrediction({
          correlationId: `corr-ok-${i}`,
          tenantId: "tenant-1",
          domain: "tickets",
          latencyMs: 50,
          confidence: 0.70,
          isFallback: false,
        });
      }
      recordPrediction({
        correlationId: "corr-fb-1",
        tenantId: "tenant-1",
        domain: "tickets",
        latencyMs: 10,
        confidence: 0,
        isFallback: true,
      });

      expect(getFallbackRateAlertCount("tickets")).toBe(0);
    });

    it("scopes fallback alerts per domain", () => {
      // leads domain: 100% fallback
      for (let i = 0; i < 5; i++) {
        recordPrediction({
          correlationId: `corr-leads-${i}`,
          tenantId: "tenant-1",
          domain: "leads",
          latencyMs: 10,
          confidence: 0,
          isFallback: true,
        });
      }
      // tickets domain: 0% fallback
      for (let i = 0; i < 5; i++) {
        recordPrediction({
          correlationId: `corr-tickets-${i}`,
          tenantId: "tenant-1",
          domain: "tickets",
          latencyMs: 50,
          confidence: 0.80,
          isFallback: false,
        });
      }

      expect(getFallbackRateAlertCount("leads")).toBeGreaterThan(0);
      expect(getFallbackRateAlertCount("tickets")).toBe(0);
    });
  });

  describe("drift alert (requirement 18.4)", () => {
    it("emits drift alert metric when avg confidence < 0.40 over 1-hour window", () => {
      // Generate predictions with low confidence (avg < 0.40)
      for (let i = 0; i < 10; i++) {
        recordPrediction({
          correlationId: `corr-low-${i}`,
          tenantId: "tenant-1",
          domain: "inventory",
          latencyMs: 50,
          confidence: 0.30, // consistently low
          isFallback: false,
        });
      }

      expect(getDriftAlertCount("inventory")).toBeGreaterThan(0);
    });

    it("does NOT emit drift alert when avg confidence >= 0.40", () => {
      for (let i = 0; i < 10; i++) {
        recordPrediction({
          correlationId: `corr-ok-${i}`,
          tenantId: "tenant-1",
          domain: "subscriptions",
          latencyMs: 50,
          confidence: 0.75,
          isFallback: false,
        });
      }

      expect(getDriftAlertCount("subscriptions")).toBe(0);
    });

    it("excludes fallback predictions from drift confidence calculation", () => {
      // All non-fallback predictions have high confidence
      for (let i = 0; i < 5; i++) {
        recordPrediction({
          correlationId: `corr-ok-${i}`,
          tenantId: "tenant-1",
          domain: "tasks",
          latencyMs: 50,
          confidence: 0.80,
          isFallback: false,
        });
      }
      // Fallback predictions have 0 confidence — should be excluded
      for (let i = 0; i < 10; i++) {
        recordPrediction({
          correlationId: `corr-fb-${i}`,
          tenantId: "tenant-1",
          domain: "tasks",
          latencyMs: 10,
          confidence: 0,
          isFallback: true,
        });
      }

      // avg confidence of non-fallback = 0.80 (well above 0.40)
      expect(getDriftAlertCount("tasks")).toBe(0);
    });
  });

  describe("recordConsumerMessage", () => {
    it("records consumer messages by topic", () => {
      recordConsumerMessage({
        messageId: "msg-1",
        topic: "crm.lead.created",
        tenantId: "tenant-1",
        processingTimeMs: 45,
        outcome: "processed",
      });
      recordConsumerMessage({
        messageId: "msg-2",
        topic: "crm.lead.created",
        tenantId: "tenant-1",
        processingTimeMs: 30,
        outcome: "processed",
      });
      recordConsumerMessage({
        messageId: "msg-3",
        topic: "helpdesk.ticket.created",
        tenantId: "tenant-1",
        processingTimeMs: 80,
        outcome: "failed",
      });

      expect(getConsumerMessageCount("crm.lead.created")).toBe(2);
      expect(getConsumerMessageCount("helpdesk.ticket.created")).toBe(1);
    });
  });

  describe("formatMlMetrics (Prometheus exposition)", () => {
    it("includes prediction count per domain", () => {
      recordPrediction({
        correlationId: "corr-1",
        tenantId: "tenant-1",
        domain: "leads",
        latencyMs: 50,
        confidence: 0.85,
        isFallback: false,
      });

      const lines = formatMlMetrics();
      const text = lines.join("\n");

      expect(text).toContain("ml_predictions_total{domain=\"leads\"} 1");
      expect(text).toContain("# TYPE ml_predictions_total counter");
    });

    it("includes latency histogram buckets", () => {
      recordPrediction({
        correlationId: "corr-1",
        tenantId: "tenant-1",
        domain: "tickets",
        latencyMs: 150,
        confidence: 0.70,
        isFallback: false,
      });

      const lines = formatMlMetrics();
      const text = lines.join("\n");

      expect(text).toContain("ml_prediction_latency_ms_bucket{domain=\"tickets\"");
      expect(text).toContain("ml_prediction_latency_ms_sum{domain=\"tickets\"}");
      expect(text).toContain("ml_prediction_latency_ms_count{domain=\"tickets\"} 1");
    });

    it("includes confidence distribution histogram", () => {
      recordPrediction({
        correlationId: "corr-1",
        tenantId: "tenant-1",
        domain: "leads",
        latencyMs: 50,
        confidence: 0.85,
        isFallback: false,
      });

      const lines = formatMlMetrics();
      const text = lines.join("\n");

      expect(text).toContain("ml_prediction_confidence_bucket{domain=\"leads\"");
      expect(text).toContain("ml_prediction_confidence_sum{domain=\"leads\"}");
      expect(text).toContain("# TYPE ml_prediction_confidence histogram");
    });

    it("includes fallback count per domain", () => {
      recordPrediction({
        correlationId: "corr-1",
        tenantId: "tenant-1",
        domain: "inventory",
        latencyMs: 10,
        confidence: 0,
        isFallback: true,
      });

      const lines = formatMlMetrics();
      const text = lines.join("\n");

      expect(text).toContain("ml_predictions_fallback_total{domain=\"inventory\"} 1");
    });

    it("includes consumer message counters", () => {
      recordConsumerMessage({
        messageId: "msg-1",
        topic: "crm.lead.updated",
        tenantId: "tenant-1",
        processingTimeMs: 30,
        outcome: "processed",
      });

      const lines = formatMlMetrics();
      const text = lines.join("\n");

      expect(text).toContain("ml_consumer_messages_total{topic=\"crm.lead.updated\"} 1");
      expect(text).toContain("ml_consumer_outcome_total{topic=\"crm.lead.updated\",outcome=\"processed\"} 1");
    });

    it("includes alert counters", () => {
      // Trigger fallback rate alert
      for (let i = 0; i < 5; i++) {
        recordPrediction({
          correlationId: `corr-${i}`,
          tenantId: "tenant-1",
          domain: "transactions",
          latencyMs: 10,
          confidence: 0,
          isFallback: true,
        });
      }

      const lines = formatMlMetrics();
      const text = lines.join("\n");

      expect(text).toContain("ml_fallback_rate_alerts_total{domain=\"transactions\"}");
      expect(text).toContain("# TYPE ml_fallback_rate_alerts_total counter");
      expect(text).toContain("# TYPE ml_drift_alerts_total counter");
    });

    it("returns empty arrays for metrics with no data", () => {
      const lines = formatMlMetrics();
      // Should still have HELP/TYPE headers even when no data
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.some((l) => l.includes("# HELP ml_predictions_total"))).toBe(true);
    });
  });

  describe("metric isolation", () => {
    it("tracks separate counters for different domains", () => {
      recordPrediction({
        correlationId: "c1",
        tenantId: "t1",
        domain: "leads",
        latencyMs: 50,
        confidence: 0.85,
        isFallback: false,
      });
      recordPrediction({
        correlationId: "c2",
        tenantId: "t1",
        domain: "tickets",
        latencyMs: 80,
        confidence: 0.60,
        isFallback: false,
      });
      recordPrediction({
        correlationId: "c3",
        tenantId: "t1",
        domain: "inventory",
        latencyMs: 100,
        confidence: 0.45,
        isFallback: true,
      });

      expect(getPredictionCount("leads")).toBe(1);
      expect(getPredictionCount("tickets")).toBe(1);
      expect(getPredictionCount("inventory")).toBe(1);
      expect(getFallbackCount("leads")).toBe(0);
      expect(getFallbackCount("tickets")).toBe(0);
      expect(getFallbackCount("inventory")).toBe(1);
    });
  });
});
