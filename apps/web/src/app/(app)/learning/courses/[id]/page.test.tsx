import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const notFoundMock = vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); });
vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const getCourseDetailMock = vi.fn();
const getCoursesMock = vi.fn();
const getMyLearningMock = vi.fn();
vi.mock("../../_data", () => ({
  getCourseDetail: (...a: unknown[]) => getCourseDetailMock(...a),
  getCourses: (...a: unknown[]) => getCoursesMock(...a),
  getMyLearning: (...a: unknown[]) => getMyLearningMock(...a),
}));
const getMyProfileMock = vi.fn();
vi.mock("@/app/_data/loaders", () => ({ getMyProfile: () => getMyProfileMock() }));

import Page from "./page";

beforeEach(() => {
  notFoundMock.mockClear();
  getMyProfileMock.mockResolvedValue({ data: { id: "emp-1", name: "Me" }, source: "api" });
  getCoursesMock.mockResolvedValue({ data: [{ id: "pre1", title: "Intro Safety" }], source: "api" });
  getMyLearningMock.mockResolvedValue({ data: [], source: "api" });
});

describe("Course detail page (GAP-LEARNING-COURSES-DETAIL-02/04)", () => {
  it("shows a retry error state (NOT 'Course not found') on a load error", async () => {
    getCourseDetailMock.mockResolvedValue({ data: null, source: "error" });
    render(await Page({ params: { id: "c1" } }));
    expect(screen.queryByText(/course not found/i)).toBeNull();
    // RefreshErrorState renders the human "couldn't load" copy
    expect(screen.getByText(/could ?n.t load course/i)).toBeInTheDocument();
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("calls notFound() for a genuine missing course (null from a healthy API)", async () => {
    getCourseDetailMock.mockResolvedValue({ data: null, source: "api" });
    await expect(Page({ params: { id: "c1" } })).rejects.toThrow(/NEXT_NOT_FOUND/);
    expect(notFoundMock).toHaveBeenCalled();
  });

  it("resolves prerequisite ids to course titles and links them (DETAIL-04)", async () => {
    getCourseDetailMock.mockResolvedValue({
      data: {
        id: "c1", code: "C1", title: "Advanced", category: "general", creditHours: "2", status: "published",
        modules: [], lessons: [], prerequisites: ["pre1"],
      },
      source: "api",
    });
    render(await Page({ params: { id: "c1" } }));
    const link = screen.getByRole("link", { name: "Intro Safety" });
    expect(link.getAttribute("href")).toBe("/learning/courses/pre1");
  });

  it("renders Enrol Now when published, unenrolled and own employee id resolves (DETAIL-02)", async () => {
    getCourseDetailMock.mockResolvedValue({
      data: {
        id: "c1", code: "C1", title: "Advanced", category: "general", creditHours: "2", status: "published",
        modules: [], lessons: [], prerequisites: [],
      },
      source: "api",
    });
    render(await Page({ params: { id: "c1" } }));
    expect(screen.getByRole("button", { name: /enrol now/i })).toBeInTheDocument();
    // never a "add ?employeeId=" fallback button
    expect(screen.queryByText(/employeeId/i)).toBeNull();
  });
});
