import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import Page from "./page";

describe("Analytics hub page", () => {
  it("GAP-ANALYTICS-HOME-04: tile labels come from i18n keys (English)", async () => {
    render(await Page());
    expect(screen.getByText("Dashboards")).toBeInTheDocument();
    expect(screen.getByText("KPI Library")).toBeInTheDocument();
    expect(screen.getByText("Data Warehouse")).toBeInTheDocument();
  });

  it("GAP-ANALYTICS-HOME-01: the legacy 'Dashboards (legacy list)' tile is gone", async () => {
    render(await Page());
    expect(screen.queryByText(/legacy list/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Simple read-only list view/i)).not.toBeInTheDocument();
  });

  it("GAP-ANALYTICS-HOME-03: the two insight tiles are distinguishable from note text alone", async () => {
    render(await Page());
    expect(screen.getByText("Recommended actions generated for your modules")).toBeInTheDocument();
    expect(screen.getByText("How well each prediction model performs")).toBeInTheDocument();
  });
});
