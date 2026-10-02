import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

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
    // StatusPill humanizes the raw "open" enum (humanizeStatus -> "Open"); the
    // table renders it as a pill, not the raw lowercase enum.
    expect(screen.getByText("Open")).toBeInTheDocument();
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

  // GAP-RECRUITMENT-HOME-01
  it("formats the Posted column with the shared Indian date format, not the raw ISO string", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: STATS, source: "api" })
      .mockResolvedValueOnce({ data: [{ ...OPENING, postedDate: "2026-09-04" }], source: "api" });
    render(await RecruitmentPage());
    expect(screen.queryByText("2026-09-04")).not.toBeInTheDocument();
    expect(screen.getByText(/4 Sep(t)? 2026|04 Sep(t)? 2026|4 Sep 2026/)).toBeInTheDocument();
  });

  // GAP-RECRUITMENT-HOME-02
  it("a 403 on the HR-only dashboard derives the cards from the openings list: no zero cards, no 'couldn't be loaded' chip", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: EMPTY_STATS, source: "error", status: 403 })
      .mockResolvedValueOnce({
        data: [OPENING, { ...OPENING, id: "job-2", status: "closed", applicationsReceived: 7, isPublished: true, vacancyType: "internship" }],
        source: "api",
      });
    render(await RecruitmentPage());
    expect(screen.queryByText("Some figures on this page couldn't be loaded.")).not.toBeInTheDocument();
    expect(screen.queryByText("Couldn't load — showing nothing")).not.toBeInTheDocument();
    const totalCard = screen.getByText("Total Vacancies").closest(".stat") as HTMLElement;
    expect(totalCard.textContent).toContain("2");
    const appsCard = screen.getByText("Applications Received").closest(".stat") as HTMLElement;
    expect(appsCard.textContent).toContain("12");
    expect(screen.getByRole("note")).toHaveTextContent(/2 vacancies you can see/);
  });

  it("any other dashboard failure keeps the chip and shows '—' instead of 0 on every card", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: EMPTY_STATS, source: "error", status: 500 })
      .mockResolvedValueOnce({ data: [OPENING], source: "api" });
    render(await RecruitmentPage());
    expect(screen.getByText("Some figures on this page couldn't be loaded.")).toBeInTheDocument();
    const totalCard = screen.getByText("Total Vacancies").closest(".stat") as HTMLElement;
    expect(totalCard.textContent).toContain("—");
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  // GAP-RECRUITMENT-HOME-03
  it("shows the internships & apprenticeships card from the dashboard", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: { ...STATS, internshipsApprenticeships: 3 }, source: "api" })
      .mockResolvedValueOnce({ data: [OPENING], source: "api" });
    render(await RecruitmentPage());
    const card = screen.getByText("Internships & Apprenticeships").closest(".stat") as HTMLElement;
    expect(card.textContent).toContain("3");
  });

  // GAP-RECRUITMENT-HOME-04
  it("shows Published / Unpublished per row", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: STATS, source: "api" })
      .mockResolvedValueOnce({
        data: [OPENING, { ...OPENING, id: "job-2", jobTitle: "Clerk", isPublished: true }],
        source: "api",
      });
    render(await RecruitmentPage());
    const clerk = screen.getByText("Clerk").closest("tr") as HTMLElement;
    expect(within(clerk).getByText("Published")).toBeInTheDocument();
    const je = screen.getByText("Junior Engineer").closest("tr") as HTMLElement;
    expect(within(je).getByText("Unpublished")).toBeInTheDocument();
  });

  // GAP-RECRUITMENT-HOME-05
  it("shows the reservation roster state and application fee per row", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: STATS, source: "api" })
      .mockResolvedValueOnce({
        data: [
          { ...OPENING, rosterStatus: "approved", feesMinor: "10000" },
          { ...OPENING, id: "job-2", jobTitle: "Clerk", rosterStatus: "none", feesMinor: null },
        ],
        source: "api",
      });
    render(await RecruitmentPage());
    const je = screen.getByText("Junior Engineer").closest("tr") as HTMLElement;
    expect(within(je).getByText("Approved")).toBeInTheDocument();
    expect(within(je).getByText("₹100.00")).toBeInTheDocument();
    const clerk = screen.getByText("Clerk").closest("tr") as HTMLElement;
    expect(within(clerk).getByText("Not set")).toBeInTheDocument();
  });

  // GAP-RECRUITMENT-HOME-06
  it("renders the careers / talent-pool links with icons, not emoji in the label text", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: STATS, source: "api" })
      .mockResolvedValueOnce({ data: [OPENING], source: "api" });
    render(await RecruitmentPage());
    const careers = screen.getByRole("link", { name: "View public careers page" });
    expect(careers.querySelector("svg")).not.toBeNull();
    const pool = screen.getByRole("link", { name: "Browse talent pool" });
    expect(pool.querySelector("svg")).not.toBeNull();
    expect(careers.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    expect(pool.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });
});
