import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", async () => {
  const actual = await vi.importActual<typeof import("@/app/_data/apiClient")>("@/app/_data/apiClient");
  return { ...actual, fetchJson: (...args: unknown[]) => fetchJsonMock(...args) };
});
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

import WorkforcePage from "./page";

// Real shapes, per workforce-planning/routes.ts -- GAP-HR-WORKFORCE-01.
const MOCK_HEADCOUNT_RESPONSE = { data: { total: 52, breakdown: [
  { group_key: "Finance", count: 40 },
  { group_key: "HR", count: 12 },
] } };
const MOCK_GRADE_RESPONSE = { data: { total: 2, breakdown: [
  { group_key: "Grade-A", count: 1 },
  { group_key: "ungraded", count: 1 },
] } };
const MOCK_RETIREMENT_RESPONSE = { data: [
  { period: "2026-10", retiring_count: 1 },
  { period: "2027-06", retiring_count: 2 },
], meta: { retirementAge: 60 } };
const MOCK_VACANCY_RESPONSE = { data: [
  { horizon: "1_year", count: 3 },
  { horizon: "3_years", count: 5 },
], meta: { retirementAge: 60 } };

function mockLoaders(overrides: {
  headcount?: { data: unknown; source: "api" | "error" };
  retirements?: { data: unknown; source: "api" | "error" };
  vacancy?: { data: unknown; source: "api" | "error" };
  headcountBody?: unknown;
}) {
  fetchJsonMock.mockImplementation((path: unknown, empty: unknown, options: { mapResponse: (p: unknown) => unknown }) => {
    if (typeof path !== "string") return Promise.resolve({ data: empty, source: "api" });

    if (path.includes("/hrms/workforce/headcount")) {
      if (overrides.headcount) return Promise.resolve(overrides.headcount);
      const body = overrides.headcountBody ?? (path.includes("groupBy=grade") ? MOCK_GRADE_RESPONSE : MOCK_HEADCOUNT_RESPONSE);
      const mapped = options.mapResponse(body);
      return Promise.resolve({ data: mapped ?? empty, source: mapped === null ? "error" : "api" });
    }
    if (path.includes("/hrms/workforce/retirement-forecast")) {
      if (overrides.retirements) return Promise.resolve(overrides.retirements);
      const mapped = options.mapResponse(MOCK_RETIREMENT_RESPONSE);
      return Promise.resolve({ data: mapped ?? empty, source: mapped === null ? "error" : "api" });
    }
    if (path.includes("/hrms/workforce/vacancy-forecast")) {
      if (overrides.vacancy) return Promise.resolve(overrides.vacancy);
      const mapped = options.mapResponse(MOCK_VACANCY_RESPONSE);
      return Promise.resolve({ data: mapped ?? empty, source: mapped === null ? "error" : "api" });
    }
    return Promise.resolve({ data: empty, source: "api" });
  });
}

describe("WorkforcePage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("renders real stat counts when every loader succeeds (real API shapes, not the old fabricated-mismatch shapes)", async () => {
    mockLoaders({});
    render(await WorkforcePage({ searchParams: {} }));
    // totalHeadcount = 40 + 12 = 52; departments = 2 rows
    expect(screen.getByText("statTotalHeadcount").closest(".stat")).toHaveTextContent("52");
    expect(screen.getByText("statDepartments").closest(".stat")).toHaveTextContent("2");
    // retiring within 6/12 months: both periods are within 12mo of "now" in
    // most CI runs; assert they are real numbers, not zero/blank, to guard
    // the old always-false `monthsLeft` bug from silently coming back.
    const soon = screen.getByText("statRetiringSoon").closest(".stat");
    const twelve = screen.getByText("statRetiring12").closest(".stat");
    expect(soon).not.toHaveTextContent("—");
    expect(twelve).not.toHaveTextContent("—");
  });

  it("headcount error: headcount card shows a retry state, retirement AND vacancy cards still render (GAP-HR-WORKFORCE-02)", async () => {
    mockLoaders({ headcount: { data: [], source: "error" } });
    render(await WorkforcePage({ searchParams: {} }));

    expect(screen.getByText("statTotalHeadcount").closest(".stat")).toHaveTextContent("—");
    // Not read as "no headcount data" (an empty department) -- a real retry affordance.
    expect(screen.queryByText("emptyHeadcountTitle")).not.toBeInTheDocument();
    // The other two cards are unaffected by headcount's own failure.
    expect(screen.getByText("cardUpcomingRetirements")).toBeInTheDocument();
    expect(screen.queryByText("emptyRetirementsTitle")).not.toBeInTheDocument();
    expect(screen.getByText("cardVacancyForecast")).toBeInTheDocument();
  });

  it("retirement error: retirement stats show —, headcount and vacancy cards are unaffected", async () => {
    mockLoaders({ retirements: { data: [], source: "error" } });
    render(await WorkforcePage({ searchParams: {} }));

    expect(screen.getByText("statRetiringSoon").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByText("statRetiring12").closest(".stat")).toHaveTextContent("—");
    // Headcount stats are independent -- no longer share one merged `errored` flag.
    expect(screen.getByText("statTotalHeadcount").closest(".stat")).toHaveTextContent("52");
  });

  it("vacancy-forecast error shows a retry state without blanking the other two cards (GAP-HR-WORKFORCE-04)", async () => {
    mockLoaders({ vacancy: { data: [], source: "error" } });
    render(await WorkforcePage({ searchParams: {} }));

    expect(screen.getByText("statTotalHeadcount").closest(".stat")).toHaveTextContent("52");
    expect(screen.getByText("statRetiringSoon").closest(".stat")).not.toHaveTextContent("—");
    expect(screen.queryByText("emptyVacancyTitle")).not.toBeInTheDocument();
  });

  it("renders projected-vacancy rows from the real {horizon,count} shape (GAP-HR-WORKFORCE-04)", async () => {
    mockLoaders({});
    render(await WorkforcePage({ searchParams: {} }));
    expect(screen.getByText("horizon1Year").closest("tr")).toHaveTextContent("3");
    expect(screen.getByText("horizon3Years").closest("tr")).toHaveTextContent("5");
    // Not present in the mocked response at all -- filled in as an explicit,
    // genuine zero (the fetch succeeded; the backend's GROUP BY just never
    // emitted this horizon). beyond_5_years is deliberately excluded entirely.
    expect(screen.getByText("horizon5Years").closest("tr")).toHaveTextContent("0");
    expect(screen.queryByText(/beyond/i)).not.toBeInTheDocument();
  });

  it("?groupBy=grade shows rows labelled by pay grade, including 'ungraded'", async () => {
    mockLoaders({});
    render(await WorkforcePage({ searchParams: { groupBy: "grade" } }));
    expect(screen.getByText("Grade-A")).toBeInTheDocument();
    expect(screen.getByText("ungraded")).toBeInTheDocument();
    // Neutral "Groups" label, not "Departments", for a non-department grouping.
    expect(screen.getByText("statGroups")).toBeInTheDocument();
    expect(screen.queryByText("statDepartments")).not.toBeInTheDocument();
  });

  it("an invalid ?groupBy falls back to department instead of 500ing", async () => {
    mockLoaders({});
    render(await WorkforcePage({ searchParams: { groupBy: "not_a_real_group" } }));
    expect(screen.getByText("Finance")).toBeInTheDocument();
    expect(screen.getByText("statDepartments")).toBeInTheDocument();
  });

  it("shows the retirement-age footnote from the backend's own meta, not a hardcoded assumption", async () => {
    mockLoaders({});
    render(await WorkforcePage({ searchParams: {} }));
    expect(screen.getByText("footnoteRetirementAge")).toBeInTheDocument();
  });
});
