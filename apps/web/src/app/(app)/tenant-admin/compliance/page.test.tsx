import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getComplianceOverviewMock = vi.fn();
vi.mock("@/app/_data/loaders", async () => {
  const actual = await vi.importActual<typeof import("@/app/_data/loaders")>("@/app/_data/loaders");
  return { ...actual, getComplianceOverview: (...a: unknown[]) => getComplianceOverviewMock(...a) };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import ComplianceDashboardPage from "./page";

const overview = {
  dpdpScore: 82,
  certInReadiness: 70,
  retentionStatus: "Compliant",
  checks: [
    { id: "c1", timestamp: "2026-02-01T10:00:00Z", title: "Consent records present", result: "pass" as const },
    { id: "c2", timestamp: "2026-02-01T11:00:00Z", title: "Retention policy stale", result: "fail" as const },
  ],
};

describe("ComplianceDashboardPage — A11Y (01) + FAILMASK (03/04)", () => {
  beforeEach(() => getComplianceOverviewMock.mockReset());

  it("renders results as StatusPills (token tones), not inline hex text", async () => {
    getComplianceOverviewMock.mockResolvedValue({ data: overview, source: "api" });
    render(await ComplianceDashboardPage());
    const pass = screen.getByText("Pass");
    const fail = screen.getByText("Fail");
    expect(pass.className).toContain("pill");
    expect(pass.className).toContain("good");
    expect(fail.className).toContain("bad");
  });

  it("shows '—' for a null score, never a fabricated 0% or undefined%", async () => {
    getComplianceOverviewMock.mockResolvedValue({
      data: { dpdpScore: null, certInReadiness: null, retentionStatus: "Unknown", checks: [] },
      source: "error",
    });
    render(await ComplianceDashboardPage());
    expect(screen.getByText("DPDP Score").closest(".stat")).toHaveTextContent("—");
    expect(document.body.textContent).not.toMatch(/undefined%/);
    expect(document.body.textContent).not.toMatch(/0%/);
  });

  it("shows a real 0 as 0.0%, not '—'", async () => {
    getComplianceOverviewMock.mockResolvedValue({
      data: { ...overview, dpdpScore: 0 },
      source: "api",
    });
    render(await ComplianceDashboardPage());
    expect(screen.getByText("DPDP Score").closest(".stat")).toHaveTextContent("0.0%");
  });
});
