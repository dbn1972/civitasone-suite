import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import type { MLDomainSummary } from "./_data";

const state = vi.hoisted(() => ({ result: { data: [] as MLDomainSummary[], source: "api" as "api" | "error" } }));
vi.mock("./_data", () => ({
  getMLDomainOverview: async () => state.result,
}));

const Hub = (await import("./page")).default;

async function show() {
  const ui = await Hub();
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

const domain = (over: Partial<MLDomainSummary>): MLDomainSummary => ({
  domain: "leads",
  totalPredictions: 100,
  accuracy: 0.9,
  fallbackRate: 0.1,
  topFactor: "tenure",
  modelVersion: 3,
  lastTrainedAt: "2026-09-01T00:00:00Z",
  ...over,
});

describe("GAP-ANALYTICS-ML-INSIGHTS-01 (FAILMASK): hub error state", () => {
  it("shows a retry panel and no '0/6' on source=error", async () => {
    state.result = { data: [], source: "error" };
    await show();
    expect(screen.getByText(/We couldn't load/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText("0/6")).not.toBeInTheDocument();
  });
});

describe("GAP-ANALYTICS-ML-INSIGHTS-02: no misleading cross-metric average", () => {
  it("does not render an 'Avg. Accuracy' stat card", async () => {
    state.result = { data: [domain({})], source: "api" };
    await show();
    expect(screen.queryByText("Avg. Accuracy")).not.toBeInTheDocument();
  });

  it("labels the leads card with its own metric (AUC-ROC), not 'Accuracy'", async () => {
    state.result = { data: [domain({})], source: "api" };
    await show();
    expect(screen.getByText(/AUC-ROC/)).toBeInTheDocument();
  });
});

describe("GAP-ANALYTICS-ML-INSIGHTS-04: last-trained + stale", () => {
  it("marks a model trained 200+ days ago as Stale and excludes it from Active", async () => {
    const old = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    state.result = { data: [domain({ lastTrainedAt: old })], source: "api" };
    await show();
    expect(screen.getByText("Stale")).toBeInTheDocument();
    // Active (not stale) = 0 of 6
    expect(screen.getByText("0/6")).toBeInTheDocument();
  });
});

describe("GAP-ANALYTICS-ML-INSIGHTS-03: honest aria-label per card", () => {
  it("the leads card aria-label names its metric, not 'accuracy'", async () => {
    state.result = { data: [domain({})], source: "api" };
    await show();
    const link = screen.getByLabelText(/Lead Scoring — AUC-ROC/i);
    expect(link).toBeInTheDocument();
  });
});
