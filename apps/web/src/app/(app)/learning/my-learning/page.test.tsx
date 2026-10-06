import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const rolesMock = vi.fn(() => ["employee"] as string[]);
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => rolesMock() }));

const getMyLearningMock = vi.fn();
const getMyProfileMock = vi.fn();
vi.mock("../_data", () => ({
  getMyLearning: (...a: unknown[]) => getMyLearningMock(...a),
  getMyProfile: () => getMyProfileMock(),
  OVERDUE_STALE_DAYS: 30,
}));
// EnrolmentsTable is another route-family's client component; stub it so this
// test focuses on HOME-02's page-level behaviour (scoping, filter, no-record).
vi.mock("./EnrolmentsTable", () => ({
  EnrolmentsTable: ({ rows }: { rows: Array<{ course: string }> }) => (
    <div data-testid="enrolments-table">{rows.map((r) => <span key={r.course}>{r.course}</span>)}</div>
  ),
}));

import MyLearningPage from "./page";

beforeEach(() => {
  rolesMock.mockReturnValue(["employee"]);
  getMyProfileMock.mockResolvedValue({ data: { id: "emp-3", name: "Ravi" }, source: "api" });
  getMyLearningMock.mockResolvedValue({ data: [], source: "api" });
});

async function renderPage(search: Record<string, string> = {}) {
  render(await MyLearningPage({ searchParams: search }));
}

describe("MyLearningPage — GAP-LEARNING-HOME-02", () => {
  it("resolves the viewer's own id and shows their enrolments with NO query parameter (no dead-end)", async () => {
    getMyLearningMock.mockResolvedValue({ data: [{ id: "e1", courseTitle: "C", courseCode: "C1", status: "enrolled", progressPct: 10, courseId: "c1", resumeLessonId: "l1", updatedAt: null }], source: "api" });
    await renderPage();
    expect(getMyLearningMock).toHaveBeenCalledWith("emp-3");
    expect(screen.queryByText("Select an employee")).not.toBeInTheDocument();
    expect(screen.getByTestId("enrolments-table")).toBeInTheDocument();
  });

  it("no linked record shows an honest message, not a uuid prompt", async () => {
    getMyProfileMock.mockResolvedValue({ data: null, source: "api", status: 404 });
    await renderPage();
    expect(screen.getByText("No employee record linked")).toBeInTheDocument();
    expect(screen.queryByText(/Append \?employeeId/)).not.toBeInTheDocument();
  });

  it("filters by ?status and reflects it in the heading", async () => {
    getMyLearningMock.mockResolvedValue({
      data: [
        { id: "e1", courseTitle: "A", courseCode: "A1", status: "completed", progressPct: 100, courseId: "c1", resumeLessonId: "", updatedAt: null },
        { id: "e2", courseTitle: "B", courseCode: "B1", status: "enrolled", progressPct: 0, courseId: "c2", resumeLessonId: "l2", updatedAt: null },
      ],
      source: "api",
    });
    await renderPage({ status: "completed" });
    expect(screen.getByText("Enrolments — completed")).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.queryByText("B")).not.toBeInTheDocument();
  });
});
