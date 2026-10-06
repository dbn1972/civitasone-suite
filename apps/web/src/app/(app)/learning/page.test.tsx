import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const rolesMock = vi.fn(() => ["employee"] as string[]);
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => rolesMock() }));

const getCoursesMock = vi.fn();
const getLmsDashboardMock = vi.fn();
const getMyProfileMock = vi.fn();
vi.mock("./_data", () => ({
  getCourses: () => getCoursesMock(),
  getLmsDashboard: (...a: unknown[]) => getLmsDashboardMock(...a),
  getMyProfile: () => getMyProfileMock(),
}));
// combineResourceState is real; keep it.

import HomePage from "./page";

beforeEach(() => {
  rolesMock.mockReturnValue(["employee"]);
  getMyProfileMock.mockResolvedValue({ data: { id: "emp-5", name: "Nina" }, source: "api" });
  getCoursesMock.mockResolvedValue({ data: [], source: "api" });
  getLmsDashboardMock.mockResolvedValue({ data: { enrolled: 2, in_progress: 1, completed: 3, overdue: 0, total: 6 }, source: "api" });
});

async function renderPage() {
  render(await HomePage());
}

describe("Learning HomePage — GAP-LEARNING-HOME-01/02/05", () => {
  it("HOME-01: dashboard stats are scoped to the signed-in employee id", async () => {
    await renderPage();
    expect(getLmsDashboardMock).toHaveBeenCalledWith("emp-5");
  });

  it("HOME-02: the stat cards link to my-learning scoped to the viewer (+status)", async () => {
    await renderPage();
    const links = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(links.some((h) => h === "/learning/my-learning?employeeId=emp-5")).toBe(true);
    expect(links.some((h) => h === "/learning/my-learning?employeeId=emp-5&status=overdue")).toBe(true);
  });

  it("HOME-05: navigation tiles show titles + descriptions, not sentences in a stat value slot", async () => {
    await renderPage();
    // the sentence that used to be stuffed into the StatCard value is gone
    expect(screen.queryByText("Sessions & nominations")).not.toBeInTheDocument();
    expect(screen.getByText("📅 Training Calendar")).toBeInTheDocument();
    expect(screen.getByText(/Scheduled programmes and your nomination status/)).toBeInTheDocument();
  });
});
