import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
const getCourseDetailMock = vi.fn();
const getMyLearningMock = vi.fn();
vi.mock("../../../../_data", () => ({
  getCourseDetail: (...a: unknown[]) => getCourseDetailMock(...a),
  getMyLearning: (...a: unknown[]) => getMyLearningMock(...a),
}));
vi.mock("@/app/_data/loaders", () => ({ getMyProfile: async () => ({ data: { id: "emp-1" }, source: "api" }) }));

import Page from "./page";

const course = {
  id: "c1", title: "Safety", modules: [{ id: "m1", title: "Mod", sequence: 1 }],
  lessons: [{ id: "l1", moduleId: "m1", title: "Lesson 1", sequence: 1, contentType: "video", durationMins: 5 }],
};

beforeEach(() => getCourseDetailMock.mockResolvedValue({ data: course, source: "api" }));

describe("Lesson page completion state", () => {
  it("shows Completed when the learner has completed the lesson", async () => {
    getMyLearningMock.mockResolvedValue({ data: [{ courseId: "c1", completedLessonIds: ["l1"] }], source: "api" });
    render(await Page({ params: Promise.resolve({ id: "c1", lessonId: "l1" }) }));
    expect(screen.getByText(/Completed/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mark complete/i })).toBeNull();
  });

  it("shows Mark complete when the lesson is not yet completed", async () => {
    getMyLearningMock.mockResolvedValue({ data: [{ courseId: "c1", completedLessonIds: [] }], source: "api" });
    render(await Page({ params: Promise.resolve({ id: "c1", lessonId: "l1" }) }));
    expect(screen.getByRole("button", { name: /mark complete/i })).toBeInTheDocument();
  });
});
