import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { DomainInsightPage } from "./DomainInsightPage";
import type { MLDomainEvaluation } from "../_data";

const emptyEval: MLDomainEvaluation = {
  totalPredictions: 0,
  accuracy: null,
  fallbackRate: null,
  topFactor: "—",
  accuracyTrend: [],
  factorBreakdown: [],
  recentPredictions: [],
};

const dataEval: MLDomainEvaluation = {
  totalPredictions: 120,
  accuracy: 0.0, // genuine 0% — must render "0%", not "—"
  fallbackRate: 0.0,
  topFactor: "tenure",
  accuracyTrend: [{ date: "2026-03-01", accuracy: 0.8 }],
  factorBreakdown: [],
  recentPredictions: [
    { id: "p1", entityId: "e1", entityLabel: "Lead A", parentId: null, prediction: 0.6, confidence: 0.9, outcome: null, createdAt: "2026-03-01T00:00:00Z" },
  ],
};

const show = (props: Parameters<typeof DomainInsightPage>[0]) =>
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <DomainInsightPage {...props} />
    </NextIntlClientProvider>,
  );

describe("GAP-ANALYTICS-ML-INSIGHTS-*-01 (FAILMASK): error state", () => {
  it("renders a retry panel and NOT the 'model active' copy on source=error", () => {
    show({ title: "Lead Scoring Insights", subtitle: "s", domain: "leads", evaluation: emptyEval, source: "error" });
    expect(screen.getByText(/We couldn't load/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
    expect(screen.queryByText(/once the ML model is active/i)).not.toBeInTheDocument();
    expect(screen.queryByText("No trend data available yet.")).not.toBeInTheDocument();
  });
});

describe("GAP-ANALYTICS-ML-INSIGHTS-SUBSCRIPTIONS-06: api + no data", () => {
  it("shows a single honest empty state, not zero stat cards", () => {
    show({ title: "Churn Prediction Insights", subtitle: "s", domain: "subscriptions", evaluation: emptyEval, source: "api" });
    expect(screen.getByText(/No active model for Churn Prediction/i)).toBeInTheDocument();
    // Not the error panel.
    expect(screen.queryByText(/We couldn't load/i)).not.toBeInTheDocument();
  });
});

describe("GAP-ANALYTICS-ML-INSIGHTS-*-05/06: 0% vs missing on real data", () => {
  it("renders a genuine 0% accuracy/fallback as '0%' (not '—')", () => {
    show({ title: "Lead Scoring Insights", subtitle: "s", domain: "leads", evaluation: dataEval, source: "api" });
    // Two 0% stat values (accuracy + fallback).
    expect(screen.getAllByText("0%").length).toBeGreaterThanOrEqual(2);
  });

  it("uses the domain's metric label for the accuracy card by default", () => {
    show({ title: "Lead Scoring Insights", subtitle: "s", domain: "leads", evaluation: dataEval, source: "api" });
    // leads -> AUC-ROC
    expect(screen.getByText("AUC-ROC")).toBeInTheDocument();
  });
});
