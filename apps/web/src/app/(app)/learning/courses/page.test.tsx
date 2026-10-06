import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const rolesMock = vi.fn<() => string[]>(() => []);
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => rolesMock() }));

const getCoursesMock = vi.fn();
const getMyLearningMock = vi.fn();
vi.mock("../_data", () => ({
  getCourses: (...a: unknown[]) => getCoursesMock(...a),
  getMyLearning: (...a: unknown[]) => getMyLearningMock(...a),
}));

import Page from "./page";

beforeEach(() => {
  rolesMock.mockReturnValue(["employee"]);
  getCoursesMock.mockResolvedValue({
    data: [
      { id: "c1", code: "C1", title: "Safety 101", category: "safety", creditHours: "12.0", status: "published" },
      { id: "c2", code: "C2", title: "Ethics", category: "general", creditHours: "1.5", status: "published" },
    ],
    source: "api",
  });
  getMyLearningMock.mockResolvedValue({
    data: [{ id: "e1", courseId: "c1", courseTitle: "Safety 101", courseCode: "C1", status: "in_progress", progressPct: 40 }],
    source: "api",
  });
});

async function renderPage(searchParams: Record<string, string> = {}) {
  render(await Page({ searchParams }));
}

describe("Course catalogue page (GAP-LEARNING-COURSES-01/02/03/04)", () => {
  it("renders a server search form with a text input named q (COURSES-02)", async () => {
    await renderPage();
    const input = screen.getByRole("searchbox", { name: /search courses/i });
    expect(input).toHaveAttribute("name", "q");
  });

  it("formats credit hours (COURSES-03) — '12.0' -> '12 hrs'", async () => {
    await renderPage();
    expect(screen.getByText("12 hrs")).toBeInTheDocument();
    expect(screen.getByText("1.5 hrs")).toBeInTheDocument();
  });

  it("shows a My status column reflecting enrolment (COURSES-04)", async () => {
    await renderPage();
    expect(screen.getByText("In Progress")).toBeInTheDocument();
  });

  it("employee sees NO status filter; HR does (COURSES-01)", async () => {
    await renderPage();
    expect(screen.queryByLabelText(/filter by status/i)).toBeNull();

    rolesMock.mockReturnValue(["hr_admin"]);
    render(await Page({ searchParams: {} }));
    expect(screen.getByLabelText(/filter by status/i)).toBeInTheDocument();
  });

  it("passes undefined status for employees (never a client-chosen draft)", async () => {
    await renderPage({ status: "draft" });
    // employee: effectiveStatus is undefined regardless of the query
    expect(getCoursesMock).toHaveBeenCalledWith(undefined, undefined);
  });
});
