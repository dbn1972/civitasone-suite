import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
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

  it("shows the data-source badge when the dashboard stats fetch fails, even though openings succeeded (HR-A finding: previously silent — stats section had no badge at all)", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: EMPTY_STATS, source: "error" })
      .mockResolvedValueOnce({ data: [OPENING], source: "api" });

    const ui = await RecruitmentPage();
    render(ui);

    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
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
});
