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

// The page reads the register (first call) and the dashboard counts (second call).
const DASH = {
  filesActive: 7, filesPending: 7, meetingsToday: 0, vehiclesInUse: 0, complianceItemsDue: 0,
  slaBreached: 2, dakPending: 0, avgPendencyDays: 4.5,
};

function installDefaults() {
  fetchJsonMock.mockReset();
  fetchJsonMock.mockImplementation(async (path: unknown) =>
    String(path).includes("/estab/dashboard") ? { data: DASH, source: "api" } : { data: [], source: "api" });
}

/** The value shown on the stat tile with this label. */
function tileValue(container: HTMLElement, label: string): string | undefined {
  const tile = Array.from(container.querySelectorAll(".stat")).find((el) => el.querySelector(".lab")?.textContent === label);
  return tile?.querySelector(".val")?.textContent ?? undefined;
}

describe("EstabFilesListPage", () => {
  beforeEach(() => {
    installDefaults();
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

describe("EstabFilesListPage — office-wide tiles share the dashboard's definition (GAP-ESTAB-DASHBOARD-01 / -02)", () => {
  beforeEach(() => {
    installDefaults();
  });

  it("'Active Files' shows the service's count of status=active files, not a count of the rows on this page", async () => {
    // Three active rows on the page, but the office has 7 (the dashboard tile shows the same 7).
    fetchJsonMock.mockResolvedValueOnce({ data: [makeFile({ id: "a" }), makeFile({ id: "b" }), makeFile({ id: "c" })], source: "api" });
    const { container } = render(await EstabFilesListPage());
    expect(tileValue(container, "Active Files")).toBe("7");
  });

  it("'Avg Pendency' is the service's average over every open file (the dashboard's number), not over the 'pending' rows", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [makeFile({ id: "a" })], source: "api" });
    const { container } = render(await EstabFilesListPage());
    expect(tileValue(container, "Avg Pendency")).toBe("4.5 days");
  });

  it("when the dashboard counts cannot be read the two tiles say so ('—') instead of showing a page-local number", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [makeFile({ id: "a" })], source: "api" });
    fetchJsonMock.mockResolvedValueOnce({ data: { ...DASH, filesActive: 0, avgPendencyDays: 0 }, source: "error" });
    const { container } = render(await EstabFilesListPage());
    expect(tileValue(container, "Active Files")).toBe("—");
    expect(tileValue(container, "Avg Pendency")).toBe("—");
    // the register itself still renders
    expect(screen.getByText("Budget allocation for Q3")).toBeInTheDocument();
  });

  it("'Closed' counts every finished file: closed, archived and disposed", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      data: [
        makeFile({ id: "c", status: "closed" }),
        makeFile({ id: "a", status: "archived" }),
        makeFile({ id: "d", status: "disposed" }),
        makeFile({ id: "x", status: "active" }),
      ],
      source: "api",
    });
    const { container } = render(await EstabFilesListPage());
    expect(tileValue(container, "Closed")).toBe("3");
  });

  it("carries the same hint as the dashboard tile so the two read as one figure", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "api" });
    const { container } = render(await EstabFilesListPage());
    const tile = Array.from(container.querySelectorAll(".stat")).find((el) => el.querySelector(".lab")?.textContent === "Active Files");
    expect(tile?.getAttribute("title")).toMatch(/same count as Active Files on the File Register/);
  });
});
