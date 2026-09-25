import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// HRMS peripheral medium findings, item 5: RecruitmentPage now gates its
// "New Vacancy"/"Post First Job" buttons on RECRUITMENT_ADMIN_ROLES (they
// used to render unconditionally). Default to an admin role so every
// pre-existing test below, which doesn't care about button visibility,
// keeps seeing the same page it always did.
let mockRoles: string[] = ["hr_admin"];
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => mockRoles,
}));

import RecruitmentPage from "./page";

const STATS = {
  totalOpenings: 3,
  openVacancies: 2,
  publishedVacancies: 1,
  internshipsApprenticeships: 0,
  applicationsInternal: 4,
  applicationsPublic: 6,
};

const EMPTY_STATS = {
  totalOpenings: 0,
  openVacancies: 0,
  publishedVacancies: 0,
  internshipsApprenticeships: 0,
  applicationsInternal: 0,
  applicationsPublic: 0,
};

const OPENING = {
  id: "job-1",
  jobTitle: "Junior Engineer",
  department: "IT",
  vacancies: 2,
  status: "open",
  applicationsReceived: 5,
  postedDate: "2026-01-15",
};

describe("RecruitmentPage (HR-A deep-verify)", () => {
  beforeEach(() => {
    mockRoles = ["hr_admin"];
    fetchJsonMock.mockReset();
  });

  it("renders dashboard stats and the openings table using the real field names both layers agree on", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: STATS, source: "api" })
      .mockResolvedValueOnce({ data: [OPENING], source: "api" });

    const ui = await RecruitmentPage();
    render(ui);

    expect(screen.getByText("Junior Engineer")).toBeInTheDocument();
    expect(screen.getByText("IT")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("open")).toBeInTheDocument();
  });

  it("shows the empty state when there are no vacancies", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: STATS, source: "api" })
      .mockResolvedValueOnce({ data: [], source: "api" });

    const ui = await RecruitmentPage();
    render(ui);

    expect(screen.getByText("No active job postings yet")).toBeInTheDocument();
  });

  it("shows a badge when the dashboard stats fetch fails, even though openings succeeded (HR-A finding: previously silent — stats section had no badge at all) — but NOT the 'showing nothing' text, since the openings table below is genuinely showing real data (manager-role finding: this exact shape is what a manager role sees, since /recruitment/dashboard is HR-only but /job-openings includes manager)", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: EMPTY_STATS, source: "error" })
      .mockResolvedValueOnce({ data: [OPENING], source: "api" });

    const ui = await RecruitmentPage();
    render(ui);

    // A badge still appears (something -- the stats -- really did fail)...
    expect(screen.getByText("Some figures on this page couldn't be loaded.")).toBeInTheDocument();
    // ...but it must not claim "showing nothing": the openings table below
    // rendered this row from real, successfully-fetched data.
    expect(screen.queryByText("Couldn't load — showing nothing")).not.toBeInTheDocument();
    expect(screen.getByText("Junior Engineer")).toBeInTheDocument();
  });

  it("shows the data-source badge when the openings fetch fails, even though dashboard stats succeeded", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: STATS, source: "api" })
      .mockResolvedValueOnce({ data: [], source: "error" });

    const ui = await RecruitmentPage();
    render(ui);

    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });

  it("shows no data-source badge when both fetches succeed", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: STATS, source: "api" })
      .mockResolvedValueOnce({ data: [OPENING], source: "api" });

    const ui = await RecruitmentPage();
    render(ui);

    expect(screen.queryByText("Couldn't load — showing nothing")).not.toBeInTheDocument();
  });

  // HRMS peripheral medium findings, item 5: create-button role gating.
  it("shows New Vacancy / Post First Job for an hr_admin", async () => {
    mockRoles = ["hr_admin"];
    fetchJsonMock
      .mockResolvedValueOnce({ data: STATS, source: "api" })
      .mockResolvedValueOnce({ data: [], source: "api" });

    const ui = await RecruitmentPage();
    render(ui);

    expect(screen.getByText("+ New Vacancy")).toBeInTheDocument();
    expect(screen.getByText("Post First Job")).toBeInTheDocument();
  });

  it("hides New Vacancy / Post First Job for a plain employee", async () => {
    mockRoles = ["employee"];
    fetchJsonMock
      .mockResolvedValueOnce({ data: STATS, source: "api" })
      .mockResolvedValueOnce({ data: [OPENING], source: "api" });

    const ui = await RecruitmentPage();
    render(ui);

    // The list still renders in full for a non-admin viewer -- only the
    // create action is gated.
    expect(screen.getByText("Junior Engineer")).toBeInTheDocument();
    expect(screen.queryByText("+ New Vacancy")).not.toBeInTheDocument();
    expect(screen.queryByText("Post First Job")).not.toBeInTheDocument();
  });
});
