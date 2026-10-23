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
  avgConfidence: 0.9,
  fallbackRate: 0.1,
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
});

describe("honest labels: ml-service only emits average confidence", () => {
  it("labels every card 'Avg. confidence' and never AUC-ROC / Precision / MAPE / Accuracy", async () => {
    state.result = { data: [domain({}), domain({ domain: "inventory", avgConfidence: 0.12 })], source: "api" };
    const { container } = await show();
    expect(screen.getAllByText("Avg. confidence").length).toBe(2);
    expect(container.textContent).not.toMatch(/AUC-ROC|Precision|MAPE|Accuracy|Last trained|Stale/);
  });

  it("does not render fields ml-service never emits (last trained, stale pill)", async () => {
    state.result = { data: [domain({})], source: "api" };
    await show();
    expect(screen.queryByText("Last trained")).not.toBeInTheDocument();
    expect(screen.queryByText("Stale")).not.toBeInTheDocument();
  });

  it("counts domains that have predictions", async () => {
    state.result = { data: [domain({}), domain({ domain: "tickets", totalPredictions: 0 })], source: "api" };
    await show();
    expect(screen.getByText("1/6")).toBeInTheDocument();
  });
});

describe("GAP-ANALYTICS-ML-INSIGHTS-03: honest aria-label per card", () => {
  it("the leads card aria-label names average confidence, not 'accuracy'", async () => {
    state.result = { data: [domain({})], source: "api" };
    await show();
    const link = screen.getByLabelText(/Lead Scoring — average confidence 90%/i);
    expect(link.getAttribute("aria-label")).not.toMatch(/accuracy/i);
  });

  it("the hub has no axe violations (contrast needs a real browser and is excluded)", async () => {
    const axe = (await import("axe-core")).default;
    state.result = { data: [domain({}), domain({ domain: "inventory", avgConfidence: 0.12 })], source: "api" };
    const { container } = await show();
    const out = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(out.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
});
