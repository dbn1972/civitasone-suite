import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => rolesMock() }));
const rolesMock = vi.fn(() => ["employee"] as string[]);

const getCompetencyProfileMock = vi.fn();
const getGapAnalysisMock = vi.fn();
const getCompetenciesMock = vi.fn();
const getMyProfileMock = vi.fn();
vi.mock("../_data", () => ({
  getCompetencyProfile: (...a: unknown[]) => getCompetencyProfileMock(...a),
  getGapAnalysis: (...a: unknown[]) => getGapAnalysisMock(...a),
  getCompetencies: () => getCompetenciesMock(),
  getMyProfile: () => getMyProfileMock(),
}));

import CompetencyPage from "./page";

const DICT = [
  { id: "comp-1", name: "Budgeting", code: "BUD" },
  { id: "comp-2", name: "Leadership", code: "LEAD" },
];

beforeEach(() => {
  rolesMock.mockReturnValue(["employee"]);
  getMyProfileMock.mockResolvedValue({ data: { id: "emp-9", name: "Asha Rao" }, source: "api" });
  getCompetenciesMock.mockResolvedValue({ data: DICT, source: "api" });
  getCompetencyProfileMock.mockResolvedValue({ data: [], source: "api" });
  getGapAnalysisMock.mockResolvedValue({ data: null, source: "api" });
});

async function renderPage(search: Record<string, string> = {}) {
  render(await CompetencyPage({ searchParams: search }));
}

describe("CompetencyPage — GAP-LEARNING-COMPETENCY-01/02/03/04/05", () => {
  it("COMPETENCY-02: defaults to the signed-in employee (no ?employeeId needed) and shows their name", async () => {
    getCompetencyProfileMock.mockResolvedValue({ data: [{ id: "h1", competencyId: "comp-1", currentLevel: 3, source: "certified", evidenceRef: null }], source: "api" });
    await renderPage();
    // resolved against the viewer's own id
    expect(getCompetencyProfileMock).toHaveBeenCalledWith("emp-9");
    expect(screen.getByText(/Asha Rao/)).toBeInTheDocument();
  });

  it("COMPETENCY-01: resolves competencyId UUIDs to names, never shows the raw id", async () => {
    getCompetencyProfileMock.mockResolvedValue({ data: [{ id: "h1", competencyId: "comp-1", currentLevel: 3, source: "certified", evidenceRef: null }], source: "api" });
    await renderPage();
    expect(screen.getByText("Budgeting")).toBeInTheDocument();
    expect(screen.queryByText("comp-1")).not.toBeInTheDocument();
  });

  it("COMPETENCY-01: unknown competency id shows the unmapped placeholder, never a uuid", async () => {
    // Contract change GAP2-LEARNING-COMPETENCY-UUID-01: the unmapped placeholder
    // wording is now "Competency (unmapped)" (was "Unknown competency").
    getCompetencyProfileMock.mockResolvedValue({ data: [{ id: "h1", competencyId: "ghost-id", currentLevel: 2, source: "manual", evidenceRef: null }], source: "api" });
    await renderPage();
    expect(screen.getByText("Competency (unmapped)")).toBeInTheDocument();
    expect(screen.queryByText("ghost-id")).not.toBeInTheDocument();
  });

  it("COMPETENCY-UUID-01: when the dictionary is UNAVAILABLE ([]), gap rows show the placeholder, never a 36-char UUID", async () => {
    const UUID = "123e4567-e89b-42d3-a456-426614174000";
    getCompetenciesMock.mockResolvedValue({ data: [], source: "error" });
    getCompetencyProfileMock.mockResolvedValue({ data: [{ id: "h1", competencyId: UUID, currentLevel: 2, source: "manual", evidenceRef: null }], source: "api" });
    getGapAnalysisMock.mockResolvedValue({
      data: { employeeId: "emp-9", roleCode: "ROLE_X", rows: [{ competencyId: UUID, requiredLevel: 3, heldLevel: 1, gap: 2, met: false }], requiredCount: 1, metCount: 0, gapCount: 1, readinessPct: 0 },
      source: "api",
    });
    await renderPage({ roleCode: "ROLE_X" });
    expect(screen.queryByText(UUID)).not.toBeInTheDocument();
    expect(screen.getAllByText("Competency (unmapped)").length).toBeGreaterThan(0);
  });

  it("COMPETENCY-02: no linked employee record shows an honest prompt, not a uuid instruction", async () => {
    getMyProfileMock.mockResolvedValue({ data: null, source: "api", status: 404 });
    await renderPage();
    expect(screen.getByText("No employee profile linked")).toBeInTheDocument();
    expect(screen.queryByText(/Append \?employeeId/)).not.toBeInTheDocument();
  });

  it("COMPETENCY-02: missing roleCode shows an explicit 'choose a role' prompt for gap analysis", async () => {
    getCompetencyProfileMock.mockResolvedValue({ data: [{ id: "h1", competencyId: "comp-1", currentLevel: 3, source: "certified", evidenceRef: null }], source: "api" });
    await renderPage();
    expect(screen.getByText("Choose a role to see gaps")).toBeInTheDocument();
  });

  it("COMPETENCY-04: gap error shows '—' stats rather than vanishing the grid", async () => {
    getGapAnalysisMock.mockResolvedValue({ data: null, source: "error" });
    await renderPage({ roleCode: "ROLE_X" });
    // stat grid is present with em-dash placeholders
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThan(0);
  });

  it("COMPETENCY-05: no requirements vs all-met are distinct messages", async () => {
    getGapAnalysisMock.mockResolvedValue({
      data: { employeeId: "emp-9", roleCode: "ROLE_X", rows: [], requiredCount: 0, metCount: 0, gapCount: 0, readinessPct: 0 },
      source: "api",
    });
    await renderPage({ roleCode: "ROLE_X" });
    expect(screen.getByText("No requirements defined")).toBeInTheDocument();
  });
});
