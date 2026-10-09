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
  // GAP2-WORKFLOW-INSTANCES-DETAIL-02 — real pure helpers (not stubs) so the
  // test exercises the actual humanisation/deep-link mapping.
  humanizeRefType: (rt: string) =>
    ({ procurement_po: "Purchase Order", finance_bill: "Finance Bill" } as Record<string, string>)[rt] ?? rt,
  hasRefDeepLink: (rt: string) =>
    ["procurement_po", "finance_bill", "leave_app", "payroll_run", "procurement_indent", "estab_file"].includes(rt),
}));
vi.mock("@/app/_data/loaders", () => ({
  buildApprovalLink: (_m: string, refType: string, refId: string) =>
    refType === "procurement_po" ? `/procurement/orders/${refId}` : `/workflow/my-tasks`,
}));
vi.mock("@/lib/directory/resolveUsers", () => ({
  resolveUsers: async () => new Map<string, string>(),
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

  // GAP2-WORKFLOW-INSTANCES-DETAIL-02 — linked record is a humanised deep-link,
  // not a raw enum code + opaque UUID.
  it("renders the linked record as a humanised hyperlink to the source record", async () => {
    const refId = "7f3c0000-0000-0000-0000-000000000001";
    getInstanceById.mockResolvedValue({
      data: { ...INST, refType: "procurement_po", refId },
      source: "api",
    });
    getInstanceHistory.mockResolvedValue({ data: [], source: "api" });
    getTasksForInstance.mockResolvedValue({ data: [], source: "api" });
    render(await InstanceDetailPage({ params: { id: "i1" } }));
    const link = screen.getByRole("link", { name: "Purchase Order" });
    expect(link).toHaveAttribute("href", `/procurement/orders/${refId}`);
    // The raw enum code and raw UUID must NOT be printed verbatim.
    expect(screen.queryByText(/procurement_po/)).not.toBeInTheDocument();
    expect(screen.queryByText(new RegExp(refId))).not.toBeInTheDocument();
  });
});
