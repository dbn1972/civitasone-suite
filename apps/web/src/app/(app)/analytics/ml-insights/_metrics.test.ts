import { describe, it, expect } from "vitest";
import { metricForDomain, predictionKindForDomain, metricBand } from "./_metrics";

describe("GAP-ANALYTICS-ML-INSIGHTS-02/03: per-domain metric labels", () => {
  it("labels AUC-ROC for leads/subscriptions, Precision for tickets/transactions, MAPE for inventory", () => {
    expect(metricForDomain("leads").label).toBe("AUC-ROC");
    expect(metricForDomain("subscriptions").label).toBe("AUC-ROC");
    expect(metricForDomain("tickets").label).toBe("Precision");
    expect(metricForDomain("transactions").label).toBe("Precision");
    expect(metricForDomain("inventory").label).toBe("MAPE");
  });

  it("marks MAPE as lower-is-better and the rest higher-is-better", () => {
    expect(metricForDomain("inventory").higherIsBetter).toBe(false);
    expect(metricForDomain("leads").higherIsBetter).toBe(true);
  });

  it("picks the right prediction kind per domain", () => {
    expect(predictionKindForDomain("leads")).toBe("probability");
    expect(predictionKindForDomain("inventory")).toBe("value");
    expect(predictionKindForDomain("tasks")).toBe("date");
  });
});

describe("GAP-ANALYTICS-ML-INSIGHTS-INVENTORY-03: metricBand inverts for MAPE", () => {
  const mape = metricForDomain("inventory");
  const auc = metricForDomain("leads");

  it("a 12% MAPE is 'good' (lower is better)", () => {
    expect(metricBand(0.12, mape)).toBe("good");
  });

  it("a 40% MAPE is 'poor'", () => {
    expect(metricBand(0.4, mape)).toBe("poor");
  });

  it("a 90% AUC is 'good' and 12% AUC is 'poor' (higher is better)", () => {
    expect(metricBand(0.9, auc)).toBe("good");
    expect(metricBand(0.12, auc)).toBe("poor");
  });
});
