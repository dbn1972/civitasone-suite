import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => ["report_user"],
  hasAnyRole: () => true,
}));

import Page from "./page";

describe("Reports hub (GAP-REPORTS-HOME-01 / HOME-03)", () => {
  it("no longer advertises the dead 'Executive Summary' tile", () => {
    render(Page());
    expect(screen.queryByText("Executive Summary")).not.toBeInTheDocument();
  });

  it("groups tiles into 'View' and 'Reports'", () => {
    render(Page());
    expect(screen.getByRole("heading", { name: "View" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Reports" })).toBeInTheDocument();
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Report Jobs")).toBeInTheDocument();
  });

  it("every tile links to a real reports route (no /reports/executive-summary)", () => {
    render(Page());
    const links = screen.getAllByRole("link");
    for (const a of links) {
      expect(a.getAttribute("href")).not.toBe("/reports/executive-summary");
    }
  });
});
