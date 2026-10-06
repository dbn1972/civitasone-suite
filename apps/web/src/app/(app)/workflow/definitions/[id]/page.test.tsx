import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const getDefinitionByIdMock = vi.fn();
vi.mock("../../_data/workflowData", () => ({
  getDefinitionById: (...a: unknown[]) => getDefinitionByIdMock(...a),
  titleCase: (s: string) => s,
  formatSlaMinutes: () => null,
}));

import DefinitionDetailPage from "./page";

const DEF = { id: "d1", code: "leave", name: "Leave Approval", version: 1, status: "active", nodes: [], edges: [] };

describe("DefinitionDetailPage (GAP-WORKFLOW-DEFINITIONS-DETAIL-02)", () => {
  beforeEach(() => { notFoundMock.mockClear(); getDefinitionByIdMock.mockReset(); });

  it("calls notFound() on a 404", async () => {
    getDefinitionByIdMock.mockResolvedValue({ data: null, source: "error", status: 404 });
    await expect(DefinitionDetailPage({ params: { id: "d1" } })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalled();
  });

  it("renders a retryable error state (not notFound) on a 500", async () => {
    getDefinitionByIdMock.mockResolvedValue({ data: null, source: "error", status: 500 });
    render(await DefinitionDetailPage({ params: { id: "d1" } }));
    expect(notFoundMock).not.toHaveBeenCalled();
    expect(screen.getAllByText(/couldn't load/i).length).toBeGreaterThan(0);
  });

  it("renders the definition on 200", async () => {
    getDefinitionByIdMock.mockResolvedValue({ data: DEF, source: "api" });
    render(await DefinitionDetailPage({ params: { id: "d1" } }));
    expect(screen.getAllByText("Leave Approval").length).toBeGreaterThan(0);
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  // GAP-WORKFLOW-DEFINITIONS-DETAIL-01 — Open in Designer lands on the designer
  // with this definition loaded.
  it("renders an 'Open in Designer' link carrying the definition id", async () => {
    getDefinitionByIdMock.mockResolvedValue({ data: DEF, source: "api" });
    render(await DefinitionDetailPage({ params: { id: "d1" } }));
    const link = screen.getByRole("link", { name: "Open in Designer" });
    expect(link).toHaveAttribute("href", "/workflow/designer?definitionId=d1");
  });
});
