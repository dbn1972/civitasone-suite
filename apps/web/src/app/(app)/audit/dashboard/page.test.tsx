import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import AuditDashboardPage from "./page";

const OK = { openObservations: 2, riskRegisterItems: 1, cagParas: 3, compliancePct: 88.5 };

describe("AuditDashboardPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("GAP-AUDIT-DASHBOARD-01: a fetch failure shows '—' and the error state, never '0.0%'", async () => {
    fetchJsonMock.mockResolvedValue({ data: { openObservations: 0, riskRegisterItems: 0, cagParas: 0, compliancePct: 0 }, source: "error" });
    render(await AuditDashboardPage());
    expect(screen.queryByText("0.0%")).not.toBeInTheDocument();
    expect(screen.getByText("We couldn't load audit dashboard.")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("live zero data still shows '0.0%'", async () => {
    fetchJsonMock.mockResolvedValue({ data: { openObservations: 0, riskRegisterItems: 0, cagParas: 0, compliancePct: 0 }, source: "api" });
    render(await AuditDashboardPage());
    expect(screen.getByText("0.0%")).toBeInTheDocument();
  });

  // GAP-AUDIT-DASHBOARD-05: the schema guarantees a number so this cannot
  // happen in practice (claim REFUTED), but the Number.isFinite guard must
  // make a hypothetical non-finite compliancePct degrade to '—', never throw.
  it("GAP-AUDIT-DASHBOARD-05: a non-finite compliancePct renders '—' instead of throwing", async () => {
    fetchJsonMock.mockResolvedValue({ data: { openObservations: 1, riskRegisterItems: 1, cagParas: 1, compliancePct: Number.NaN }, source: "api" });
    const el = await AuditDashboardPage();
    expect(() => render(el)).not.toThrow();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("GAP-AUDIT-DASHBOARD-02: quick links include CAG Audit, Vigilance and Investigation", async () => {
    fetchJsonMock.mockResolvedValue({ data: OK, source: "api" });
    render(await AuditDashboardPage());
    expect(screen.getByText("CAG Audit")).toBeInTheDocument();
    expect(screen.getByText("Vigilance")).toBeInTheDocument();
    expect(screen.getByText("Investigation")).toBeInTheDocument();
  });
});
