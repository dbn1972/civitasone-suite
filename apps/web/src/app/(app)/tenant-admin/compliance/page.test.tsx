import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { render } from "@/test-utils/intl-render";

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

describe("ComplianceDashboardPage — provenance (02) + pagination (04)", () => {
  beforeEach(() => getComplianceOverviewMock.mockReset());

  it("GAP-TENANT-ADMIN-COMPLIANCE-02: shows method, as-of and per-check evidence counts", async () => {
    getComplianceOverviewMock.mockResolvedValue({
      data: {
        ...overview,
        checks: [
          { ...overview.checks[0], evidenceCount: 2 },
          { ...overview.checks[1], evidenceCount: 0 },
        ],
        provenance: { method: "Derived from persisted compliance controls.", scope: "tenant:t1", asOf: "2026-02-01T11:00:00Z", complete: false },
      },
      source: "api",
    });
    render(await ComplianceDashboardPage());
    const prov = screen.getByTestId("compliance-provenance");
    expect(prov).toHaveTextContent(/derived from your recorded compliance controls/i);
    expect(prov).toHaveTextContent(/As of/);
    expect(prov).toHaveTextContent(/not yet tested/i);
    expect(screen.getByText("2 items")).toBeInTheDocument();
    expect(screen.getByText("None recorded")).toBeInTheDocument();
  });

  it("GAP-TENANT-ADMIN-COMPLIANCE-04: 30 checks paginate instead of rendering all at once", async () => {
    const checks = Array.from({ length: 30 }, (_, i) => ({
      id: `c${i}`, timestamp: "2026-02-01T10:00:00Z", title: `Control ${i}`, result: "pass" as const,
    }));
    getComplianceOverviewMock.mockResolvedValue({ data: { ...overview, checks }, source: "api" });
    render(await ComplianceDashboardPage());
    expect(screen.getAllByText(/^Control \d+$/)).toHaveLength(10);
  });

  it("GAP-TENANT-ADMIN-COMPLIANCE-04: an errored page shows exactly one error message", async () => {
    getComplianceOverviewMock.mockResolvedValue({
      data: { dpdpScore: null, certInReadiness: null, retentionStatus: "Unknown", checks: [] },
      source: "error",
    });
    render(await ComplianceDashboardPage());
    expect(screen.getAllByText(/couldn't load/i)).toHaveLength(1);
  });
});
