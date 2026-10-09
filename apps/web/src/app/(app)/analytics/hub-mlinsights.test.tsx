import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// getTranslations → key-echoing translator so tile labels are predictable.
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

let sessionRoles: string[] = [];
vi.mock("@/lib/auth/roleGuard", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/roleGuard")>("@/lib/auth/roleGuard");
  return { ...actual, getSessionRoles: () => sessionRoles };
});

import Page from "./page";

async function show() {
  const ui = await Page();
  return render(ui);
}

describe("Analytics hub — ML Insights tile gating (GAP2-ANALYTICS-MLINSIGHTS-01)", () => {
  beforeEach(() => { sessionRoles = []; });

  it("HIDES the ML Insights tile from a plain analytics_user", async () => {
    sessionRoles = ["analytics_user"];
    await show();
    // label key is "tiles.mlInsights.label"
    expect(screen.queryByText("tiles.mlInsights.label")).not.toBeInTheDocument();
    // other tiles still present
    expect(screen.getByText("tiles.dashboards.label")).toBeInTheDocument();
  });

  it("SHOWS the ML Insights tile to an analytics_admin", async () => {
    sessionRoles = ["analytics_admin"];
    await show();
    expect(screen.getByText("tiles.mlInsights.label")).toBeInTheDocument();
  });
});
