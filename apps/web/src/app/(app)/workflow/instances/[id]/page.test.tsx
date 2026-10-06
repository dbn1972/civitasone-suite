import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const notFoundMock = vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); });
vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const getInstanceById = vi.fn();
const getInstanceHistory = vi.fn();
const getTasksForInstance = vi.fn();
vi.mock("../../_data/workflowData", () => ({
  getInstanceById: (...a: unknown[]) => getInstanceById(...a),
  getInstanceHistory: (...a: unknown[]) => getInstanceHistory(...a),
  getTasksForInstance: (...a: unknown[]) => getTasksForInstance(...a),
  titleCase: (s: string) => s.charAt(0).toUpperCase() + s.slice(1),
}));

import InstanceDetailPage from "./page";

const INST = {
  id: "i1", name: "INST-1", status: "active", version: 2,
  definitionName: null, refType: null, refId: null, currentNode: "inspection",
};

describe("InstanceDetailPage (GAP-WORKFLOW-INSTANCES-DETAIL-03/06)", () => {
  beforeEach(() => {
    notFoundMock.mockClear();
    getInstanceById.mockReset();
    getInstanceHistory.mockReset();
    getTasksForInstance.mockReset();
  });

  it("calls notFound() when the instance is a 404", async () => {
    getInstanceById.mockResolvedValue({ data: null, source: "error", status: 404 });
    getInstanceHistory.mockResolvedValue({ data: [], source: "api" });
    getTasksForInstance.mockResolvedValue({ data: [], source: "api" });
    await expect(InstanceDetailPage({ params: { id: "i1" } })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("shows instance.currentNode as the current step even when history failed", async () => {
    getInstanceById.mockResolvedValue({ data: INST, source: "api" });
    getInstanceHistory.mockResolvedValue({ data: [], source: "error" });
    getTasksForInstance.mockResolvedValue({ data: [], source: "api" });
    render(await InstanceDetailPage({ params: { id: "i1" } }));
    const label = screen.getByText("Current step");
    expect(label.closest(".stat")?.textContent).toContain("Inspection");
  });

  it("shows '—' (not 0) for Open tasks when the tasks fetch errored", async () => {
    getInstanceById.mockResolvedValue({ data: INST, source: "api" });
    getInstanceHistory.mockResolvedValue({ data: [], source: "api" });
    getTasksForInstance.mockResolvedValue({ data: [], source: "error" });
    render(await InstanceDetailPage({ params: { id: "i1" } }));
    const statLabel = screen.getAllByText("Open tasks").find((el) => el.closest(".stat"));
    const card = statLabel?.closest(".stat");
    expect(card?.textContent).toContain("—");
    expect(card?.textContent).not.toContain("0");
  });
});
