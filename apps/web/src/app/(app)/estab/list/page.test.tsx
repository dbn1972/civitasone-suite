import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import EstabFilesListPage from "./page";

function makeFile(overrides: Record<string, unknown> = {}) {
  return {
    id: "f1",
    fileNo: "F/2026/001",
    subject: "Budget allocation for Q3",
    classification: "unclassified" as const,
    department: "Finance",
    createdBy: "—",
    createdDate: "2026-09-01",
    currentHolder: undefined,
    status: "active" as const,
    dueDate: undefined,
    tags: [],
    ...overrides,
  };
}

describe("EstabFilesListPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("GAP-ESTAB-LIST-01: masks subject for secret/top_secret files", async () => {
    const files = [
      makeFile({ id: "f1", classification: "secret", subject: "Sensitive cabinet note" }),
      makeFile({ id: "f2", classification: "top_secret", subject: "Very sensitive ops" }),
      makeFile({ id: "f3", classification: "confidential", subject: "Tender for road work" }),
    ];
    fetchJsonMock.mockResolvedValueOnce({ data: files, source: "api" });

    const ui = await EstabFilesListPage();
    render(ui);

    // Secret and top_secret subjects should be masked.
    expect(screen.queryByText("Sensitive cabinet note")).not.toBeInTheDocument();
    expect(screen.queryByText("Very sensitive ops")).not.toBeInTheDocument();
    expect(screen.getAllByText("[Classified]")).toHaveLength(2);
    // Confidential is visible.
    expect(screen.getByText("Tender for road work")).toBeInTheDocument();
  });

  it("GAP-ESTAB-LIST-02: stat label reads 'Closed', not 'Closed (MTD)'", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [makeFile({ status: "archived" })], source: "api" });
    const ui = await EstabFilesListPage();
    const { container } = render(ui);

    const labs = Array.from(container.querySelectorAll(".lab"));
    expect(labs.some((l) => l.textContent === "Closed")).toBe(true);
    expect(labs.some((l) => l.textContent?.includes("MTD"))).toBe(false);
  });

  it("GAP-ESTAB-LIST-03: banner does not promise SLA on pendency", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "api" });
    const ui = await EstabFilesListPage();
    render(ui);

    expect(screen.queryByText(/SLA on pendency/)).not.toBeInTheDocument();
  });

  it("GAP-ESTAB-LIST-04: only one primary button; Guided File is ghost", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "api" });
    const ui = await EstabFilesListPage();
    const { container } = render(ui);

    // PageHeader actions: Guided File = btn ghost, Create File = btn primary.
    const primaryBtns = container.querySelectorAll(".ph .btn.primary");
    expect(primaryBtns.length).toBe(1);
    expect(primaryBtns[0]?.textContent).toContain("Create File");
  });

  it("GAP-ESTAB-LIST-05: classification shows capitalised label", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [makeFile({ classification: "top_secret", subject: "x" })], source: "api" });
    const ui = await EstabFilesListPage();
    render(ui);

    expect(screen.getByText("Top Secret")).toBeInTheDocument();
  });

  it("GAP-ESTAB-LIST-06: segment reads 'Pending' not 'In transit'", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [makeFile({ status: "pending" })], source: "api" });
    const ui = await EstabFilesListPage();
    render(ui);

    // Segment control should show "Pending", not "In transit".
    expect(screen.queryByText("In transit")).not.toBeInTheDocument();
    // "Pending" appears in both the stat label and the segment control.
    expect(screen.getAllByText("Pending").length).toBeGreaterThanOrEqual(2);
  });
});
