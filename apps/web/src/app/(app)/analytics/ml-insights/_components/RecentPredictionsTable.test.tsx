import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { RecentPredictionsTable, entityDisplay } from "./RecentPredictionsTable";
import type { RecentPredictionRow } from "../_data";

const row = (over: Partial<RecentPredictionRow> = {}): RecentPredictionRow => ({
  id: "p1",
  entityId: "11112222-3333-4444-5555-666677778888",
  entityLabel: null,
  parentId: null,
  prediction: 0.5,
  confidence: 0.9,
  outcome: null,
  createdAt: "2026-03-01T10:00:00.000Z",
  ...over,
});

const show = (props: Parameters<typeof RecentPredictionsTable>[0]) =>
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <RecentPredictionsTable {...props} />
    </NextIntlClientProvider>,
  );

describe("GAP-ANALYTICS-ML-INSIGHTS-*-UUID: Entity column", () => {
  it("shows the human label when provided", () => {
    expect(entityDisplay(row({ entityLabel: "Widget A" }))).toBe("Widget A");
  });

  it("falls back to a shortened id (last 8 chars) for an opaque UUID", () => {
    expect(entityDisplay(row())).toBe("…77778888");
  });

  it("short id keeps only the last 8 characters", () => {
    expect(entityDisplay(row({ entityId: "abcdef0123456789" }))).toBe("…23456789");
  });

  it("renders the label in the table and links via the real id", () => {
    show({ predictions: [row({ entityLabel: "Widget A" })], source: "api", domain: "inventory", rowLinkPrefix: "/inventory/" });
    const link = screen.getByText("Widget A").closest("a") as HTMLAnchorElement;
    expect(link).toBeTruthy();
    expect(link.getAttribute("href")).toBe("/inventory/11112222-3333-4444-5555-666677778888");
  });
});

describe("GAP-ANALYTICS-ML-INSIGHTS-*-UUID: prediction formatting by kind", () => {
  it("probability -> percentage", () => {
    show({ predictions: [row({ prediction: 0.73 })], source: "api", domain: "leads", predictionKind: "probability" });
    expect(screen.getByText("73%")).toBeInTheDocument();
  });

  it("value -> plain number (no %)", () => {
    show({ predictions: [row({ prediction: 1250 })], source: "api", domain: "inventory", predictionKind: "value" });
    expect(screen.getByText("1,250")).toBeInTheDocument();
    expect(screen.queryByText("125000%")).not.toBeInTheDocument();
  });
});

describe("GAP-ANALYTICS-ML-INSIGHTS-*-07/08: export gating", () => {
  it("hides the CSV export when the user may not export", () => {
    show({ predictions: [row()], source: "api", domain: "leads", canExport: false });
    expect(screen.queryByText(/CSV/)).not.toBeInTheDocument();
  });

  it("shows the CSV export (with a notice) when permitted", () => {
    show({ predictions: [row()], source: "api", domain: "leads", canExport: true });
    expect(screen.getByText(/CSV/)).toBeInTheDocument();
    expect(screen.getByText(/Export leaves the system/)).toBeInTheDocument();
  });
});
