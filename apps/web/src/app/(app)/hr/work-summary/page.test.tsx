import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

const getSessionRolesMock = vi.fn(() => ["hr_admin"] as string[]);
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => getSessionRolesMock(),
}));

import WorkSummaryPage from "./page";

async function renderPage(searchParams?: { offset?: string }) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {await WorkSummaryPage({ searchParams })}
    </NextIntlClientProvider>,
  );
}

// getData() returns fetchJson()'s result directly, so mocking fetchJson
// means these mocks must be the FINAL LoaderResult<WorkSummaryPage> shape.
function loaderResult(rows: Record<string, unknown>[], total: number, offset = 0) {
  return { data: { rows, total, offset }, source: "api" };
}

describe("WorkSummaryPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    getSessionRolesMock.mockReset().mockReturnValue(["hr_admin"]);
  });

  it("shows the real overall grade, not a fabricated tasks-completed count (GAP-HR-WORK-SUMMARY-01)", async () => {
    fetchJsonMock.mockResolvedValue(
      loaderResult([{ id: "a1", employee: "Asha", employeeId: "e1", department: "Finance", period: "2025-26", overallGrade: 8, rating: 4, status: "approved" }], 1),
    );
    await renderPage();
    expect(screen.getByText("8.0")).toBeInTheDocument();
    expect(screen.queryByText("8 / 10")).not.toBeInTheDocument();
  });

  it("renders a genuinely unrated appraisal as '—', not '0.0 / 5' (GAP-HR-WORK-SUMMARY-02)", async () => {
    fetchJsonMock.mockResolvedValue(
      loaderResult([{ id: "a1", employee: "Asha", employeeId: "e1", department: "Finance", period: "2025-26", overallGrade: 8, rating: null, status: "pending" }], 1),
    );
    await renderPage();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("0.0 / 5")).not.toBeInTheDocument();
  });

  it("counts distinct employees by id, not by display name (GAP-HR-WORK-SUMMARY-06)", async () => {
    fetchJsonMock.mockResolvedValue(
      loaderResult(
        [
          { id: "a1", employee: "Ravi Kumar", employeeId: "e1", department: "Finance", period: "2025-26", overallGrade: 7, rating: 3.5, status: "approved" },
          { id: "a2", employee: "Ravi Kumar", employeeId: "e2", department: "Works", period: "2025-26", overallGrade: 6, rating: 3, status: "approved" },
        ],
        2,
      ),
    );
    await renderPage();
    // Two different employeeIds sharing a display name must count as 2, not 1.
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);
  });

  it("formats the period as 'FY <period>' instead of the raw value (GAP-HR-WORK-SUMMARY-06)", async () => {
    fetchJsonMock.mockResolvedValue(
      loaderResult([{ id: "a1", employee: "Asha", employeeId: "e1", department: "Finance", period: "2025-26", overallGrade: 7, rating: 3.5, status: "approved" }], 1),
    );
    await renderPage();
    expect(screen.getByText("FY 2025-26")).toBeInTheDocument();
  });

  it("shows a range banner and a Next link when the backend reports more rows than this page returned (GAP-HR-WORK-SUMMARY-05)", async () => {
    const rows = Array.from({ length: 500 }, (_, i) => ({
      id: `a${i}`, employee: `Emp ${i}`, employeeId: `e${i}`, department: "Finance", period: "2025-26", overallGrade: 5, rating: 3, status: "approved",
    }));
    fetchJsonMock.mockResolvedValue(loaderResult(rows, 620));
    await renderPage();
    expect(screen.getByText("Showing 1–500 of 620")).toBeInTheDocument();
    expect(screen.getByText("Next")).toBeInTheDocument();
  });

  it("shows the self-scoped subtitle (not the HR-wide one) for a manager session", async () => {
    getSessionRolesMock.mockReturnValue(["manager"]);
    fetchJsonMock.mockResolvedValue(
      loaderResult([{ id: "a1", employee: "Me", employeeId: "e1", department: "Finance", period: "2025-26", overallGrade: 7, rating: 3.5, status: "approved" }], 1),
    );
    await renderPage();
    expect(screen.getByText("Your annual appraisal period work summary and supervisor ratings.")).toBeInTheDocument();
  });

  it("still blocks a role with no work-summary access at all", async () => {
    getSessionRolesMock.mockReturnValue(["citizen"]);
    await renderPage();
    expect(screen.queryByText("Work Summaries")).not.toBeInTheDocument();
  });
});
