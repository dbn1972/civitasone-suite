import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getOrgHierarchyLevelsMock = vi.fn();
vi.mock("@/app/_data/loaders", () => ({
  getOrgHierarchyLevels: () => getOrgHierarchyLevelsMock(),
}));

vi.mock("@/lib/auth/roleGuard", () => ({
  requireAnyRole: () => undefined,
  PLATFORM_ADMIN_ROLES: ["platform_admin", "super_admin", "tenant_admin"],
}));

import OrgConfigRoute from "./page";

const LEVELS = [
  { id: "a", order: 1, label: "Alpha", description: "", examples: "", color: "#1e40af" },
  { id: "b", order: 2, label: "Beta", description: "", examples: "", color: "#065f46" },
];

describe("OrgConfigRoute (GAP-PLATFORM-ADMIN-ORG-CONFIG-05)", () => {
  beforeEach(() => getOrgHierarchyLevelsMock.mockReset());

  it("derives the subtitle and tiles from the real levels, not hardcoded GFR/Top-down", async () => {
    getOrgHierarchyLevelsMock.mockResolvedValue({ data: LEVELS, source: "api" });
    render((await OrgConfigRoute()) as React.ReactElement);
    expect(screen.getByText(/Alpha → Beta/)).toBeInTheDocument();
    // No fabricated literals remain.
    expect(screen.queryByText("GFR 2017")).not.toBeInTheDocument();
    expect(screen.queryByText("Top-down")).not.toBeInTheDocument();
    // Top/Lowest level tiles reflect real data.
    expect(screen.getByText("Top level")).toBeInTheDocument();
    expect(screen.getByText("Lowest level")).toBeInTheDocument();
  });

  it("shows '—' tiles on a load error", async () => {
    getOrgHierarchyLevelsMock.mockResolvedValue({ data: [], source: "error" });
    render((await OrgConfigRoute()) as React.ReactElement);
    // At least one tile shows the em-dash missing-value marker.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByText("GFR 2017")).not.toBeInTheDocument();
  });
});
